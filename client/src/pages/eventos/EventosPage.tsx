// Eventos: degustaciones, ferias, catas, cenas maridaje y corporativos.
// Contesta "¿Me conviene hacer eventos?": cada evento muestra lo que entró (entradas + vino)
// contra lo que costó (vino vendido, comisiones, gastos y botellas abiertas).
import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CalendarClock, CalendarHeart, MapPin, Plus, Users } from 'lucide-react'
import clsx from 'clsx'
import { CHART_COLORS, EVENT_KIND_LABELS, type EventKind } from '@shared/constants'
import { today } from '@shared/dates'
import { dateLong, dateShort, int, money, pct, relativeDays } from '@/lib/format'
import { useNewParam } from '@/lib/hooks'
import { usePeriod } from '@/lib/period'
import { useApi } from '@/lib/queries'
import { Button, Card, EmptyState, ErrorState, ExportButton, HelpBox, InfoTip, Loading, PageHeader, PeriodPicker, ProgressBar } from '@/components/ui'
import { ChartCard, RankBars } from '@/components/charts'
import { EventFormModal } from './EventFormModal'
import { EXPLAIN, KindBadge, Kpi, MiniBars, nb, resultClass, resultPhrase, tileMoney } from './parts'
import type { EventWithSummary } from './types'

const plural = (n: number, one: string, many: string) => `${int(n)} ${n === 1 ? one : many}`

/** "De 4 eventos, 2 dejaron plata y 2 perdieron. En total dejó $ X: por cada $ 100 que pusiste… volvieron $ 130." */
function verdict(n: number, winners: number, losers: number, someEmpty: boolean, result: number, roi: number | null): string {
  const of = someEmpty ? `De los ${plural(n, 'evento', 'eventos')} con datos` : n === 1 ? 'Del único evento' : `De ${plural(n, 'evento', 'eventos')}`
  let how: string
  if (n === 1) how = winners ? 'dejó plata' : losers ? 'perdió plata' : 'salió hecho'
  else if (winners === n) how = 'todos dejaron plata'
  else if (losers === n) how = 'ninguno dejó plata'
  else how = `${int(winners)} ${winners === 1 ? 'dejó' : 'dejaron'} plata${losers ? ` y ${int(losers)} ${losers === 1 ? 'perdió' : 'perdieron'}` : ''}`
  const total = `En total ${resultPhrase(result).toLowerCase()}`
  const back = roi != null && result > 0 ? `: por cada $\u00a0100 que pusiste en gastos y botellas, volvieron $\u00a0${int(Math.round(100 + roi * 100))}` : ''
  return `${of}, ${how}. ${total}${back}.`
}

export default function EventosPage() {
  const navigate = useNavigate()
  const { period, label: periodLabel, preset, setPreset } = usePeriod()
  const [formOpen, openForm, closeForm] = useNewParam()
  const q = useApi<EventWithSummary[]>('/events')
  const t0 = today()

  const events = useMemo(() => q.data ?? [], [q.data])
  /** Desde hoy en adelante, el más cercano primero. */
  const upcoming = useMemo(() => events.filter((e) => e.date >= t0).sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1)), [events, t0])
  /** Ya hechos y dentro del período elegido (del más nuevo al más viejo, como vienen de la API). */
  const done = useMemo(() => events.filter((e) => e.date < t0 && e.date >= period.from && e.date <= period.to), [events, t0, period.from, period.to])
  const lastDone = useMemo(() => events.find((e) => e.date < t0), [events, t0])

  /** Eventos con algo cargado (ventas, gastos o botellas). Los vacíos no entran en rankings ni promedios: darían $ 0 y engañarían. */
  const withData = useMemo(() => done.filter((e) => e.summary.sales_count || e.summary.expenses_count || e.summary.opened_count), [done])

  const k = useMemo(() => {
    const sum = (f: (e: EventWithSummary) => number) => done.reduce((a, e) => a + f(e), 0)
    const result = sum((e) => e.summary.result)
    const investment = sum((e) => e.summary.investment)
    const best = withData.length ? withData.reduce((b, e) => (e.summary.result > b.summary.result ? e : b), withData[0]) : null
    return {
      count: done.length,
      attendees: sum((e) => e.attendees ?? 0),
      result,
      investment,
      roi: investment > 0 ? result / investment : null,
      best,
      winners: withData.filter((e) => e.summary.result > 0.004).length,
      losers: withData.filter((e) => e.summary.result < -0.004).length,
      opened: sum((e) => e.summary.bottles_opened),
      openedCost: sum((e) => e.summary.bottles_opened_cost),
      noData: done.length - withData.length,
    }
  }, [done, withData])

  /** Resultado promedio por tipo de evento (máx. 6 tipos: entran todos). */
  const byKind = useMemo(() => {
    const m = new Map<EventKind, { n: number; result: number }>()
    for (const e of withData) {
      const x = m.get(e.kind) ?? { n: 0, result: 0 }
      x.n += 1
      x.result += e.summary.result
      m.set(e.kind, x)
    }
    return [...m.entries()]
      .map(([kind, x]) => ({ kind, label: EVENT_KIND_LABELS[kind], n: x.n, avg: x.result / x.n, total: x.result }))
      .sort((a, b) => b.avg - a.avg)
  }, [withData])

  const ranking = useMemo(() => [...withData].sort((a, b) => b.summary.result - a.summary.result), [withData])
  const widen = preset === 'ultimos_12_meses' || preset === 'este_anio' || preset === 'anio_pasado' ? 'todo' : 'ultimos_12_meses'

  return (
    <>
      <PageHeader
        title="Eventos"
        description="Degustaciones, ferias, catas y cenas: cuánto te costó cada una y cuánto te dejó."
        actions={
          <>
            <ExportButton path="/events/export" params={{ from: period.from, to: period.to }} />
            <Button variant="primary" icon={Plus} onClick={openForm}>
              Nuevo evento
            </Button>
          </>
        }
      />

      <HelpBox id="eventos">
        <p>
          Un evento es una <b>inversión</b>: lo que gastás en copas, picada y difusión, más las botellas que abrís para degustar, tiene que volver en entradas y ventas de vino.{' '}
          <b>Acá ves si volvió.</b>
        </p>
        <p>
          <b>Ejemplo:</b> una degustación de 25 personas a $ 8.000 la entrada ($ 200.000) donde vendiste 18 botellas por $ 350.000 (que te costaron $ 180.000). Gastaste $ 120.000
          en picada y copas y abriste 6 botellas que te costaron $ 54.000. Resultado: 200.000 + 350.000 − 180.000 − 120.000 − 54.000 = <b>$ 196.000</b>, o sea{' '}
          <b>$ 7.840 por persona</b>.
        </p>
        <ul>
          <li>
            <b>Cómo se carga:</b> creá el evento y, desde su ficha, cargá las ventas (entradas y vino) y los gastos eligiendo ese evento, y registrá las botellas que abriste.
          </li>
          <li>
            <b>¿Por qué importa?</b> Un evento puede parecer un éxito («¡vendimos un montón!») y en realidad haber costado más de lo que dejó. Separando sus números sabés cuáles
            repetir y cuáles no.
          </li>
        </ul>
      </HelpBox>

      {q.error ? (
        <ErrorState className="mt-6" error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <Loading />
      ) : events.length === 0 ? (
        <Card className="mt-6">
          <EmptyState
            icon={CalendarHeart}
            title="Todavía no cargaste eventos"
            action={
              <Button icon={Plus} onClick={openForm}>
                Cargar mi primer evento
              </Button>
            }
          >
            Si hacés degustaciones, ferias o catas, cargalas acá: vas a ver cuánto gastaste, cuánto vendiste y cuánto te quedó de cada una. Con nombre y fecha alcanza para
            empezar.
          </EmptyState>
        </Card>
      ) : (
        <>
          {/* Próximos: no dependen del período, son lo que hay que preparar */}
          {upcoming.length > 0 && (
            <section className="mt-6" aria-labelledby="proximos">
              <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 id="proximos" className="flex items-center gap-2 text-[19px] font-extrabold text-ink">
                  <CalendarClock size={20} className="text-sky-deep" aria-hidden /> Próximos
                </h2>
                <p className="text-[13.5px] text-ink-soft">Cargá los gastos a medida que salen, así ves si te pasás del presupuesto antes de que sea tarde.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {upcoming.map((e) => (
                  <UpcomingCard key={e.id} e={e} />
                ))}
              </div>
            </section>
          )}

          <div className="mt-8 mb-4 flex flex-wrap items-center justify-between gap-3">
            <PeriodPicker />
            {done.length > 0 && <p className="text-[13.5px] text-ink-soft">{plural(done.length, 'evento hecho', 'eventos hechos')} en {periodLabel.toLowerCase()}</p>}
          </div>

          {done.length === 0 ? (
            <Card>
              <EmptyState
                compact
                icon={CalendarHeart}
                title="No hubo eventos en este período"
                action={
                  <Button onClick={() => setPreset(widen)}>{widen === 'todo' ? 'Ver todos los eventos' : 'Ver los últimos 12 meses'}</Button>
                }
              >
                {lastDone ? (
                  <>
                    El último fue <b className="text-ink">«{lastDone.name}»</b> el {dateLong(lastDone.date)} ({resultPhrase(lastDone.summary.result).toLowerCase()}). Ampliá el período
                    para compararlo con los demás.
                  </>
                ) : (
                  'Todavía no hiciste ningún evento: los que cargaste son a futuro (están arriba, en «Próximos»).'
                )}
              </EmptyState>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                <Kpi
                  label="Eventos hechos"
                  tone="sky"
                  info={{ title: 'Eventos hechos', text: 'Los eventos con fecha dentro del período que ya pasaron. Los que todavía no llegaron están en «Próximos».' }}
                  value={int(k.count)}
                  hint={[k.attendees ? `${plural(k.attendees, 'persona', 'personas')} en total` : 'Sin personas cargadas', k.noData ? `${int(k.noData)} sin datos` : ''].filter(Boolean).join(' · ')}
                />
                <Kpi
                  label="Resultado de los eventos"
                  info={EXPLAIN.resultado}
                  value={tileMoney(k.result)}
                  title={money(k.result)}
                  valueClassName={resultClass(k.result)}
                  hint={
                    k.roi != null ? (
                      <>
                        Retorno {pct(k.roi, 0)} <InfoTip size={13} title={EXPLAIN.retorno.title} text={EXPLAIN.retorno.text} className="align-[-2px]" />
                      </>
                    ) : (
                      'Sin gastos ni botellas abiertas'
                    )
                  }
                />
                <Kpi
                  label="Mejor evento"
                  info={{ title: 'Mejor evento', text: 'El que dejó el resultado más alto en el período (entradas + vino − todo lo que costó).' }}
                  value={k.best?.name ?? '—'}
                  title={k.best?.name}
                  valueClassName="!text-[1.2rem] leading-tight !whitespace-normal line-clamp-2"
                  hint={k.best ? `${resultPhrase(k.best.summary.result)} · ${nb(dateShort(k.best.date))}` : 'Ningún evento tiene datos cargados'}
                />
                <Kpi
                  label="Botellas abiertas"
                  tone="mustard"
                  info={EXPLAIN.botellas_abiertas}
                  value={int(k.opened)}
                  hint={k.opened ? `Costaron ${nb(money(k.openedCost, { decimals: 0 }))} (ya restadas del resultado)` : 'No abriste botellas para degustar'}
                />
              </div>

              {withData.length > 0 && (
              <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                <ChartCard
                  title="¿Cuáles dejaron plata?"
                  subtitle="Resultado de cada evento, del mejor al peor. En rojo, los que perdieron."
                  table={{
                    columns: [
                      { key: 'name', header: 'Evento' },
                      { key: 'date', header: 'Fecha', format: (v) => dateShort(String(v)) },
                      { key: 'revenue', header: 'Entró', align: 'right', format: (v) => money(Number(v), { decimals: 0 }) },
                      { key: 'costs', header: 'Costó', align: 'right', format: (v) => money(Number(v), { decimals: 0 }) },
                      { key: 'result', header: 'Resultado', align: 'right', format: (v) => money(Number(v), { decimals: 0 }) },
                      { key: 'per', header: 'Por persona', align: 'right', format: (v) => (v == null ? '—' : money(Number(v), { decimals: 0 })) },
                    ],
                    rows: ranking.map((e) => ({ name: e.name, date: e.date, revenue: e.summary.revenue, costs: e.summary.costs, result: e.summary.result, per: e.summary.per_attendee })),
                  }}
                >
                  <RankBars
                    items={ranking.map((e) => ({ label: e.name, value: Math.round(e.summary.result), sublabel: dateShort(e.date) }))}
                    color={CHART_COLORS.ganancia}
                    max={8}
                  />
                  {ranking.length > 8 && <p className="mt-3 text-[12.5px] text-muted">Se muestran los 8 mejores. Tocá «Ver tabla» para ver todos.</p>}
                </ChartCard>

                <Card title="¿Qué tipo de evento te conviene?" subtitle="Resultado promedio por evento, según el tipo.">
                  <RankBars items={byKind.map((x) => ({ label: x.label, value: Math.round(x.avg), sublabel: plural(x.n, 'evento', 'eventos') }))} color={CHART_COLORS.ganancia} max={6} />
                  <p className="mt-4 rounded-xl bg-cream-deep px-3.5 py-2.5 text-[13.5px] leading-snug text-ink-soft">
                    <b className="text-ink">En resumen:</b> {verdict(withData.length, k.winners, k.losers, k.noData > 0, k.result, k.roi)}
                    {byKind.length > 1 && byKind[0].avg > 0 && (
                      <>
                        {' '}
                        Los que mejor te funcionan: <b className="text-ink">{byKind[0].label.toLowerCase()}</b> ({nb(money(byKind[0].avg, { decimals: 0 }))} promedio).
                      </>
                    )}
                  </p>
                  {k.noData > 0 && (
                    <p className="mt-2 text-[12.5px] leading-snug text-warn">
                      {k.noData === 1 ? 'Hay 1 evento' : `Hay ${int(k.noData)} eventos`} sin ventas, gastos ni botellas cargadas: no {k.noData === 1 ? 'entra' : 'entran'} en el ranking
                      ni en los promedios. Si {k.noData === 1 ? 'lo hiciste, completalo' : 'los hiciste, completalos'} desde su ficha.
                    </p>
                  )}
                </Card>
              </div>
              )}

              <section className="mt-6" aria-labelledby="hechos">
                <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 id="hechos" className="text-[19px] font-extrabold text-ink">
                    Cómo le fue a cada uno
                  </h2>
                  <p className="text-[13.5px] text-ink-soft">Tocá un evento para ver sus cuentas, ventas, gastos y botellas abiertas.</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {done.map((e) => (
                    <EventCard key={e.id} e={e} />
                  ))}
                </div>
              </section>
            </>
          )}
        </>
      )}

      <EventFormModal open={formOpen} onClose={closeForm} onSaved={(ev) => navigate(`/eventos/${ev.id}`)} />
    </>
  )
}

/** Personas y lugar en una línea: "En el local · 24 personas". */
function Meta({ e }: { e: EventWithSummary }) {
  if (!e.location && !e.attendees) return null
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-ink-soft">
      {e.location && (
        <span className="inline-flex min-w-0 items-center gap-1">
          <MapPin size={13} className="shrink-0 text-muted" aria-hidden />
          <span className="truncate">{e.location}</span>
        </span>
      )}
      {e.attendees ? (
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
          <Users size={13} className="text-muted" aria-hidden />
          {plural(e.attendees, 'persona', 'personas')}
        </span>
      ) : null}
    </p>
  )
}

/** Tarjeta de un evento ya hecho: resultado, por persona y lo que entró vs. lo que costó. */
function EventCard({ e }: { e: EventWithSummary }) {
  const s = e.summary
  const empty = !s.sales_count && !s.expenses_count && !s.opened_count
  return (
    <article className="vh-card relative flex min-w-0 flex-col gap-3 p-4 transition-[border,box-shadow] hover:border-line-strong hover:shadow-[var(--shadow-pop)] sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <KindBadge kind={e.kind} />
        <span className="text-[13px] font-semibold whitespace-nowrap text-muted" title={dateLong(e.date)}>
          {dateShort(e.date)}
        </span>
      </div>
      <div className="min-w-0">
        <h3 className="text-[17px] leading-snug font-extrabold text-ink">
          <Link to={`/eventos/${e.id}`} className="line-clamp-2 after:absolute after:inset-0 after:rounded-[var(--radius-card)] focus-visible:outline-none">
            {e.name}
          </Link>
        </h3>
        <Meta e={e} />
      </div>
      {empty ? (
        <p className="mt-auto rounded-xl bg-warn-soft px-3 py-2 text-[13px] leading-snug text-warn">
          Todavía no tiene ventas, gastos ni botellas abiertas cargadas. Entrá y completalo para saber cómo le fue.
        </p>
      ) : (
        <>
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <span className="vh-label block">Resultado</span>
              <span className={clsx('vh-num block truncate text-[1.6rem] leading-tight font-extrabold', resultClass(s.result))}>{money(s.result, { decimals: 0 })}</span>
            </div>
            {s.per_attendee != null && (
              <div className="shrink-0 text-right">
                <span className="vh-label block">Por persona</span>
                <span className={clsx('vh-num block text-[15px] font-extrabold', resultClass(s.per_attendee))}>{money(s.per_attendee, { decimals: 0 })}</span>
              </div>
            )}
          </div>
          <MiniBars revenue={s.revenue} costs={s.costs} className="mt-auto" />
        </>
      )}
    </article>
  )
}

/** Tarjeta de un evento que todavía no pasó: cuándo es, entrada y cuánto del presupuesto ya se usó. */
function UpcomingCard({ e }: { e: EventWithSummary }) {
  const s = e.summary
  const when = relativeDays(e.date)
  return (
    <article className="vh-card relative flex min-w-0 flex-col gap-3 border-sky/70 bg-sky-soft/45 p-4 transition-[border,box-shadow] hover:border-sky-deep/50 hover:shadow-[var(--shadow-pop)] sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <KindBadge kind={e.kind} />
        <span className="rounded-full bg-paper px-2.5 py-0.5 text-[12.5px] font-extrabold whitespace-nowrap text-sky-deep">{when === 'hoy' ? '¡Es hoy!' : when}</span>
      </div>
      <div className="min-w-0">
        <h3 className="text-[17px] leading-snug font-extrabold text-ink">
          <Link to={`/eventos/${e.id}`} className="line-clamp-2 after:absolute after:inset-0 after:rounded-[var(--radius-card)] focus-visible:outline-none">
            {e.name}
          </Link>
        </h3>
        <p className="mt-0.5 text-[13px] font-semibold text-ink-soft first-letter:uppercase">{dateLong(e.date)}</p>
        <Meta e={e} />
      </div>
      <dl className="mt-auto grid grid-cols-2 gap-2 text-[13px]">
        <div>
          <dt className="vh-label">Entrada</dt>
          <dd className="vh-num font-bold text-ink">{e.ticket_price ? money(e.ticket_price, { decimals: 0 }) : 'Gratis'}</dd>
        </div>
        <div className="text-right">
          <dt className="vh-label">Ya pusiste</dt>
          <dd className="vh-num font-bold text-ink">{money(s.investment, { decimals: 0 })}</dd>
        </div>
      </dl>
      {e.budget ? (
        <div>
          <ProgressBar value={s.investment} max={e.budget} mode="budget" />
          <p className="mt-1 text-[12.5px] text-ink-soft">
            {s.investment > e.budget
              ? `Te pasaste ${nb(money(s.investment - e.budget, { decimals: 0 }))} del presupuesto de ${nb(money(e.budget, { decimals: 0 }))}.`
              : `Te quedan ${nb(money(e.budget - s.investment, { decimals: 0 }))} de ${nb(money(e.budget, { decimals: 0 }))} de presupuesto.`}
          </p>
        </div>
      ) : (
        <p className="text-[12.5px] text-muted">Sin presupuesto. Ponerle un tope ayuda a no gastar de más.</p>
      )}
    </article>
  )
}
