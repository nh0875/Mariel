// Ayuda: el manual del sistema en criollo. Por dónde empezar (con lo que ya hiciste marcado), cómo hacer
// cada cosa, cómo calcula los números, el diccionario completo (cada "?" del sistema linkea acá:
// /ayuda#<concepto>) y dónde están tus datos.
import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BookOpen, Calculator, CircleCheck, ChevronDown, HardDrive, Lock, MessageCircleQuestion, Rocket, Search, ShieldCheck, Truck, X } from 'lucide-react'
import clsx from 'clsx'
import { GLOSSARY, type GlossaryEntry, type GlossaryKey } from '@/lib/glossary'
import { useAccounts, useApi, useSettings } from '@/lib/queries'
import { Badge, Button, EmptyState, HelpBox, PageHeader } from '@/components/ui'
import { SectionIndex, norm, useHashScroll, type IndexItem } from '../configuracion/parts'
import type { SystemInfo } from '../configuracion/types'
import { FAQ } from './faq'
import { HowItWorks } from './HowItWorks'

const INDEX: IndexItem[] = [
  { id: 'empeza-por-aca', label: 'Empezá por acá', icon: Rocket },
  { id: 'como-hago', label: '¿Cómo hago para…?', icon: MessageCircleQuestion },
  { id: 'como-calcula', label: 'Cómo calcula el sistema', icon: Calculator },
  { id: 'diccionario', label: 'Diccionario', icon: BookOpen },
  { id: 'tus-datos', label: 'Tus datos', icon: HardDrive },
]

const GROUPS: GlossaryEntry['group'][] = ['Resultados', 'Costos y precios', 'Stock', 'Caja y deudas', 'Impuestos y contexto']

function Section({ id, title, intro, children }: { id: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="font-display text-[2rem] leading-none text-ink">{title}</h2>
      {intro && <p className="mt-2 mb-4 max-w-3xl text-[15px] text-ink-soft [&_b]:text-ink">{intro}</p>}
      {!intro && <div className="mb-4" />}
      {children}
    </section>
  )
}

// ───────────────────────── Empezá por acá ─────────────────────────

interface Step {
  title: string
  text: ReactNode
  done: boolean | null
  cta: { label: string; to: string }
  more?: { label: string; to: string }[]
}

function StartSteps() {
  const navigate = useNavigate()
  const { data: settings } = useSettings()
  const { data: accounts } = useAccounts()
  const { data: sys } = useApi<SystemInfo>('/system')
  const count = (t: string) => sys?.counts.find((c) => c.table === t)?.count ?? 0
  const known = !!settings && !!accounts && !!sys
  const steps: Step[] = [
    {
      title: 'Configurá tu negocio y medios de pago',
      text: 'Tu nombre, la condición fiscal y, sobre todo, cuánto te cobra cada medio de pago y en qué cuenta entra la plata.',
      done: known ? !!settings!.business.owner.trim() : null,
      cta: { label: 'Ir a Configuración', to: '/configuracion#negocio' },
      more: [{ label: 'Medios de pago', to: '/configuracion#medios-de-pago' }],
    },
    {
      title: 'Cargá tus cuentas y saldos iniciales',
      text: '¿Cuánta plata hay hoy en la caja, en el banco y en Mercado Pago? Ese es el punto de partida de la caja.',
      done: known ? accounts!.some((a) => a.initial_balance !== 0) || count('payments') > 0 : null,
      cta: { label: 'Ir a Caja y bancos', to: '/caja' },
    },
    {
      title: 'Cargá tus vinos (o importalos desde Excel)',
      text: 'Con costo, precio y las botellas que tenés hoy. Si ya los tenés en una planilla, usá «Importar desde Excel» en Vinos y stock.',
      done: known ? count('products') > 0 : null,
      cta: { label: 'Cargar un vino', to: '/vinos?nuevo=1' },
      more: [{ label: 'Importar desde Excel', to: '/vinos' }],
    },
    {
      title: 'Cargá las compras y ventas del día a día',
      text: 'Con los botones «+ Venta» y «+ Compra» de arriba, desde cualquier pantalla. El stock, el costo y la caja se actualizan solos.',
      done: known ? count('sales') > 0 || count('purchases') > 0 : null,
      cta: { label: 'Cargar una venta', to: '/ventas?nuevo=1' },
      more: [{ label: 'Cargar una compra', to: '/compras?nuevo=1' }],
    },
    {
      title: 'Cargá los gastos fijos una vez y generalos cada mes',
      text: 'Alquiler, sueldos, contador, internet: los cargás una sola vez en «Gastos fijos» y cada mes los generás con un clic.',
      done: known ? count('recurring_expenses') > 0 : null,
      cta: { label: 'Ir a Gastos', to: '/gastos' },
    },
    {
      title: 'Mirá Inicio y Reportes',
      text: 'Cuánto vendiste, cuánto ganaste, qué vinos te dejan más y cuánta plata tenés. Cada número tiene su «?» que explica cómo se calcula.',
      done: null,
      cta: { label: 'Ir a Inicio', to: '/' },
      more: [{ label: 'Reportes', to: '/reportes' }],
    },
  ]
  const next = steps.findIndex((s) => s.done === false)
  const primaryIdx = next >= 0 ? next : steps.length - 1
  const doneCount = steps.filter((s) => s.done).length
  return (
    <>
      {known && (
        <p className="-mt-2 mb-3 text-[14px] font-bold text-ink-soft">
          {doneCount === 5 ? '¡Ya hiciste todo lo básico! Ahora es cuestión de cargar el día a día.' : `Llevás ${doneCount} de 5 pasos.`}
        </p>
      )}
      <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className={clsx('vh-card flex min-w-0 flex-col gap-2 p-4', i === primaryIdx && 'ring-2 ring-brown/40')}>
            <div className="flex items-start gap-3">
              <span
                className={clsx(
                  'grid h-9 w-9 shrink-0 place-items-center rounded-full font-display text-[1.35rem] leading-none',
                  s.done ? 'bg-good-soft text-good' : 'bg-mustard/50 text-ink',
                )}
                aria-hidden
              >
                {s.done ? <CircleCheck size={20} strokeWidth={2.6} /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="leading-snug font-extrabold text-ink">
                  <span className="sr-only">Paso {i + 1}: </span>
                  {s.title}
                </h3>
                {s.done && <Badge tone="good" className="mt-1">Hecho</Badge>}
                {i === 5 && <Badge tone="sky" className="mt-1">Todos los días</Badge>}
              </div>
            </div>
            <p className="flex-1 text-[14px] leading-snug text-ink-soft">{s.text}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              {i === primaryIdx ? (
                <Button variant="primary" size="sm" onClick={() => navigate(s.cta.to)}>
                  {s.cta.label}
                </Button>
              ) : (
                <Link to={s.cta.to} className="text-[14px] font-bold text-sky-deep hover:underline">
                  {s.cta.label} →
                </Link>
              )}
              {s.more?.map((m) => (
                <Link key={m.label} to={m.to} className="text-[13.5px] font-bold text-ink-soft hover:text-ink hover:underline">
                  {m.label}
                </Link>
              ))}
            </div>
          </li>
        ))}
      </ol>
    </>
  )
}

// ───────────────────────── Preguntas ─────────────────────────

function FaqList({ open, setOpen }: { open: Set<string>; setOpen: (fn: (s: Set<string>) => Set<string>) => void }) {
  const [q, setQ] = useState('')
  const words = norm(q).split(/\s+/).filter(Boolean)
  const items = words.length ? FAQ.filter((f) => words.every((w) => norm(`${f.q} ${f.keywords ?? ''}`).includes(w))) : FAQ
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  return (
    <div>
      <SearchBox value={q} onChange={setQ} placeholder="Buscá una pregunta (ej: cobrar, retiro, flete)…" />
      {items.length === 0 ? (
        <EmptyState icon={MessageCircleQuestion} title="No encontramos esa pregunta" compact>
          Probá con otra palabra (por ejemplo «venta», «caja» o «stock»), o buscá el concepto en el diccionario de abajo.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
          {items.map((f) => {
            const isOpen = open.has(f.id) || words.length > 0
            return (
              <li key={f.id} id={f.id} className="scroll-mt-24">
                <button
                  type="button"
                  onClick={() => toggle(f.id)}
                  aria-expanded={isOpen}
                  aria-controls={`${f.id}-a`}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-cream/70"
                >
                  <span className="flex-1 text-[15.5px] font-bold text-ink">{f.q}</span>
                  <ChevronDown size={19} className={clsx('shrink-0 text-ink-soft transition-transform', isOpen && 'rotate-180')} aria-hidden />
                </button>
                {isOpen && (
                  <div id={`${f.id}-a`} className="vh-anim-fade px-4 pb-4 text-[14.5px] leading-relaxed text-ink-soft [&_b]:text-ink">
                    {f.a}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="relative mb-3 block max-w-md">
      <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" aria-hidden />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onChange('')}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-10 w-full rounded-full border border-line-strong bg-paper pr-9 pl-9 text-[14.5px] placeholder:text-muted/70 focus:border-brown focus:ring-[3px] focus:ring-brown/15 focus:outline-none"
      />
      {value && (
        <button type="button" onClick={() => onChange('')} className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-full p-0.5 text-muted hover:text-ink" aria-label="Borrar búsqueda">
          <X size={16} />
        </button>
      )}
    </label>
  )
}

// ───────────────────────── Diccionario ─────────────────────────

const ENTRIES = Object.entries(GLOSSARY) as [GlossaryKey, GlossaryEntry][]

function Dictionary({ query, setQuery }: { query: string; setQuery: (v: string) => void }) {
  const words = norm(query).split(/\s+/).filter(Boolean)
  const shown = words.length ? ENTRIES.filter(([, e]) => words.every((w) => norm(`${e.title} ${e.short} ${e.long ?? ''} ${e.formula ?? ''}`).includes(w))) : ENTRIES
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4">
        <SearchBox value={query} onChange={setQuery} placeholder="Buscá un concepto (ej: margen, CMV, caja)…" />
        <p className="mb-3 text-[13.5px] text-muted">
          {words.length ? `${shown.length} de ${ENTRIES.length} conceptos` : `${ENTRIES.length} conceptos`}
        </p>
      </div>
      {shown.length === 0 ? (
        <EmptyState icon={BookOpen} title="No encontramos ese concepto" compact action={<Button onClick={() => setQuery('')}>Ver todo el diccionario</Button>}>
          Probá con otra palabra. Si es una duda de cómo hacer algo, fijate en «¿Cómo hago para…?».
        </EmptyState>
      ) : (
        <div className="space-y-7">
          {GROUPS.map((g) => {
            const list = shown.filter(([, e]) => e.group === g)
            if (!list.length) return null
            return (
              <div key={g}>
                <p className="vh-eyebrow mb-3">{g}</p>
                <div className="grid gap-3 lg:grid-cols-2">
                  {list.map(([key, e]) => (
                    <article key={key} id={key} className="vh-card scroll-mt-24 p-4 sm:p-5">
                      <h3 className="text-[17px] leading-tight font-extrabold text-ink">{e.title}</h3>
                      <p className="mt-1 text-[15px] text-ink">{e.short}</p>
                      {e.long && <p className="mt-2 text-[14.5px] leading-relaxed text-ink-soft">{e.long}</p>}
                      {e.formula && (
                        <p className="mt-2.5 rounded-lg bg-cream-deep px-2.5 py-1.5 text-[14px] font-semibold text-ink">
                          <span className="vh-label mr-1.5 !text-brown">Cálculo</span>
                          {e.formula}
                        </p>
                      )}
                      {e.example && (
                        <p className="mt-2 text-[14px] text-ink-soft">
                          <b className="text-ink">Ejemplo:</b> {e.example}
                        </p>
                      )}
                      {e.why && (
                        <p className="mt-2 text-[14px] text-ink-soft">
                          <b className="text-ink">¿Por qué importa?</b> {e.why}
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ───────────────────────── Tus datos ─────────────────────────

function YourData() {
  const { data: sys } = useApi<SystemInfo>('/system')
  const where = sys && !sys.in_memory ? sys.data_dir : null
  const cards: { icon: typeof HardDrive; title: string; body: ReactNode }[] = [
    {
      icon: HardDrive,
      title: 'Dónde viven',
      body: (
        <>
          <p>
            Todo queda en <b>un solo archivo</b> (vinoh.db) adentro de la carpeta <b>data</b> del programa{where ? ':' : '.'}
          </p>
          {where && <code className="block rounded-lg bg-cream-deep px-2.5 py-1.5 font-mono text-[12.5px] break-all text-ink">{where}</code>}
          <p>No lo abras ni lo muevas mientras el programa está abierto.</p>
        </>
      ),
    },
    {
      icon: ShieldCheck,
      title: 'Copias de seguridad',
      body: (
        <>
          <p>
            Todos los días se guarda una copia automática (las últimas 30, en <b>data/backups</b>), y también antes de borrar todo, cargar el ejemplo o restaurar.
          </p>
          <p>
            Hacé una copia a mano o volvé a una anterior desde{' '}
            <Link to="/configuracion#backups" className="font-bold text-sky-deep hover:underline">
              Configuración → Copias de seguridad
            </Link>
            .
          </p>
        </>
      ),
    },
    {
      icon: Lock,
      title: 'Privacidad',
      body: (
        <>
          <p>
            <b>Nada sale de tu computadora.</b> El sistema funciona sin internet, no hay usuarios en la nube ni nadie de afuera que pueda entrar: solo responde en esta compu.
          </p>
          <p>La contracara: si la compu se rompe, los datos se van con ella. Por eso conviene descargar una copia de vez en cuando y guardarla en otro lado.</p>
        </>
      ),
    },
    {
      icon: Truck,
      title: 'Pasarlo a otra computadora',
      body: (
        <ol className="ml-4 list-decimal space-y-1 marker:font-bold marker:text-brown">
          <li>
            <b>La más fácil:</b> cerrá el programa y copiá la carpeta completa de VINOH! (con la carpeta data adentro) a un pendrive. En la otra compu, pegala y abrí el archivo INICIAR.
          </li>
          <li>
            <b>Con una copia:</b> en esta compu, Configuración → Copias de seguridad → «Hacer una copia ahora» y «Descargar». En la otra (con VINOH! ya instalado), «Restaurar desde un archivo».
          </li>
        </ol>
      ),
    },
  ]
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {cards.map((c) => (
        <div key={c.title} className="vh-card p-5">
          <div className="mb-2 flex items-center gap-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-cream-deep text-brown" aria-hidden>
              <c.icon size={18} />
            </span>
            <h3 className="text-[16.5px] font-extrabold text-ink">{c.title}</h3>
          </div>
          <div className="space-y-2 text-[14.5px] leading-relaxed text-ink-soft [&_b]:text-ink">{c.body}</div>
        </div>
      ))}
    </div>
  )
}

// ───────────────────────── Página ─────────────────────────

export default function AyudaPage() {
  const [dictQuery, setDictQuery] = useState('')
  const [openFaq, setOpenFaq] = useState<Set<string>>(() => new Set())
  // Si llegás desde un "?" (/ayuda#cmv) o a una pregunta (/ayuda#faq-retiro), te lleva ahí y la resalta.
  useHashScroll(true, (id) => {
    if (id in GLOSSARY) setDictQuery('')
    if (id.startsWith('faq-')) setOpenFaq((s) => new Set(s).add(id))
  })
  const index = useMemo(() => INDEX, [])
  return (
    <>
      <PageHeader title="Ayuda" description="El manual del sistema, en criollo: por dónde empezar, cómo hacer cada cosa y qué significa cada número." />
      <HelpBox id="ayuda">
        <p>
          Acá está <b>todo lo que necesitás para usar el sistema sin depender de nadie</b>: los primeros pasos, las preguntas de todos los días y el significado de cada número.
        </p>
        <p>
          <b>Ejemplo:</b> si en Inicio ves «Margen bruto 38 %» y no sabés qué es, tocá el <b>?</b> que tiene al lado y después «Ver más en Ayuda»: te trae directo a la explicación, con la cuenta y un
          ejemplo con pesos.
        </p>
        <p>
          <b>¿Por qué importa?</b> Un número que no entendés no te sirve para decidir. El sistema explica cómo calcula cada cosa para que confíes en lo que ves (y puedas chequearlo).
        </p>
      </HelpBox>

      <div className="mt-6 lg:grid lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-8">
        <SectionIndex items={index} />
        <div className="min-w-0 space-y-12">
          <Section id="empeza-por-aca" title="Empezá por acá" intro="Seis pasos, en este orden. Los que ya hiciste aparecen marcados.">
            <StartSteps />
          </Section>

          <Section id="como-hago" title="¿Cómo hago para…?" intro="Las dudas de todos los días, con los pasos y el porqué. Tocá una pregunta para ver la respuesta.">
            <FaqList open={openFaq} setOpen={setOpenFaq} />
          </Section>

          <Section
            id="como-calcula"
            title="Cómo calcula el sistema"
            intro={
              <>
                Todo el sistema usa las mismas reglas, así un número es igual en Inicio, en Reportes y en el Excel. Acá están, con <b>un mes de ejemplo</b> para seguirlas con la cabeza.
              </>
            }
          >
            <HowItWorks />
          </Section>

          <Section id="diccionario" title="Diccionario" intro="Cada concepto que aparece en el sistema: qué es, cómo se calcula, un ejemplo y por qué te importa.">
            <Dictionary query={dictQuery} setQuery={setDictQuery} />
          </Section>

          <Section id="tus-datos" title="Tus datos" intro="Dónde quedan guardados, cómo se cuidan y cómo llevarlos a otra computadora.">
            <YourData />
          </Section>
        </div>
      </div>
    </>
  )
}
