// Piezas chicas de la sección Eventos, armadas con el kit.
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Briefcase, CalendarHeart, Grape, Tent, UtensilsCrossed, Wine, type LucideIcon } from 'lucide-react'
import { CHART_COLORS, EVENT_KIND_LABELS, type EventKind } from '@shared/constants'
import { Badge, InfoTip } from '@/components/ui'
import type { GlossaryKey } from '@/lib/glossary'
import { money, moneyCompact } from '@/lib/format'
import { TONE_VAR, type Tone } from '@/lib/nav'

/** Evita que "$ 12.000" o "19 ago" se corten en dos renglones. */
export const nb = (s: string) => s.replace(/ /g, ' ')

/** Plata para tarjetas: completa hasta $ 10 M, abreviada arriba (el valor exacto va en el title). */
export const tileMoney = (n: number) => (Math.abs(n) >= 10_000_000 ? moneyCompact(n) : money(n, { decimals: 0 }))

export const KIND_ICON: Record<EventKind, LucideIcon> = {
  degustacion: Wine,
  feria: Tent,
  cata_privada: Grape,
  corporativo: Briefcase,
  maridaje: UtensilsCrossed,
  otro: CalendarHeart,
}

const KIND_TONE: Record<EventKind, 'sky' | 'orange' | 'mustard' | 'neutral' | 'coral'> = {
  degustacion: 'sky',
  feria: 'orange',
  cata_privada: 'mustard',
  corporativo: 'neutral',
  maridaje: 'coral',
  otro: 'neutral',
}

export function KindBadge({ kind }: { kind: EventKind }) {
  const Icon = KIND_ICON[kind] ?? CalendarHeart
  return (
    <Badge tone={KIND_TONE[kind] ?? 'neutral'} icon={<Icon size={13} strokeWidth={2.5} aria-hidden />}>
      {EVENT_KIND_LABELS[kind] ?? kind}
    </Badge>
  )
}

/**
 * Explicaciones de cada número de un evento (para los "?").
 * Están juntas para que la tarjeta, la ficha y el Excel digan lo mismo.
 */
export const EXPLAIN = {
  entradas: {
    title: 'Entradas',
    text: 'Lo que cobraste por entradas, cubiertos u otros ítems que no son un vino del stock (en la venta, son los renglones «no es vino»). Si la venta tuvo descuento, se reparte en proporción.',
  },
  ventas_vino: {
    title: 'Ventas de vino',
    text: 'Lo que cobraste por botellas vendidas en las ventas que cargaste con este evento (en el momento o encargadas ahí).',
  },
  ingresos: {
    title: 'Ingresos del evento',
    text: 'Entradas + ventas de vino: todo lo que se cobró en ventas asociadas al evento (se haya cobrado ya o no).',
  },
  gastos_evento: {
    title: 'Gastos del evento',
    text: 'Los gastos que cargaste eligiendo este evento: copas, hielo, picada, difusión, sonido, alquiler del lugar… Cuentan por su monto aunque todavía no los hayas pagado.',
  },
  botellas_abiertas: {
    title: 'Botellas abiertas',
    text: 'Botellas que salieron del stock para el evento sin venderse (para degustar, regalar o sortear), valorizadas a lo que te costaron. No es plata nueva que sale de la caja, pero es vino que ya no vas a poder vender: por eso es un costo del evento.',
  },
  resultado: {
    title: 'Resultado del evento',
    text: 'Entradas + ventas de vino − costo del vino vendido − comisiones − gastos del evento − botellas abiertas. Si es positivo, el evento dejó plata; si es negativo, lo pagaste vos.',
  },
  por_persona: {
    title: 'Resultado por persona',
    text: 'El resultado dividido la cantidad de personas que fueron. Sirve para comparar eventos de distinto tamaño: una cata de 15 personas puede dejar más por cabeza que una feria de 200.',
  },
  retorno: {
    title: 'Retorno de lo que pusiste',
    text: 'Resultado ÷ (gastos del evento + botellas abiertas). Ej: si pusiste $100.000 y el resultado fue $50.000, el retorno es 50 %: recuperaste lo que pusiste y ganaste la mitad encima. Negativo = no se recuperó.',
  },
  presupuesto: {
    title: 'Presupuesto',
    text: 'El tope que te pusiste para el evento. Se compara con lo que llevás puesto: gastos del evento + botellas abiertas (a su costo). Si pasa del 100 %, te pasaste.',
  },
} as const

/**
 * Tarjeta con un número importante. Como StatTile del kit, pero el "?" puede ser del glosario
 * (term) o una explicación propia de esta pantalla (info).
 */
export function Kpi({
  label,
  value,
  term,
  info,
  hint,
  tone,
  title,
  className,
  valueClassName,
}: {
  label: string
  value: ReactNode
  term?: GlossaryKey
  info?: { title: string; text: ReactNode }
  hint?: ReactNode
  tone?: Tone
  title?: string
  className?: string
  valueClassName?: string
}) {
  return (
    <div className={clsx('vh-card flex min-w-0 flex-col gap-1.5 p-4 sm:p-5', className)}>
      <div className="flex items-center gap-1.5">
        {tone && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: TONE_VAR[tone] }} aria-hidden />}
        <span className="min-w-0 text-[13.5px] leading-tight font-bold text-ink-soft">{label}</span>
        {term && <InfoTip term={term} />}
        {info && <InfoTip title={info.title} text={info.text} />}
      </div>
      <div
        className={clsx(
          'truncate leading-none font-extrabold tracking-tight',
          // Si viene un color (verde si dejó plata, rojo si perdió), no le ponemos el color por defecto:
          // las dos clases pelearían y ganaría la que esté después en el CSS.
          !/(^|\s)!?text-(good|bad|warn|ink|muted|ink-soft)(\s|$)/.test(valueClassName ?? '') && 'text-ink',
          typeof value === 'string' && value.length > 11 ? 'text-[1.35rem]' : 'text-[1.6rem]',
          valueClassName,
        )}
        title={title}
      >
        {value}
      </div>
      {hint && <div className="text-[12.5px] leading-snug text-muted">{hint}</div>}
    </div>
  )
}

/** Color del resultado: verde si dejó plata, rojo si perdió. */
export const resultClass = (n: number) => (n > 0.004 ? 'text-good' : n < -0.004 ? 'text-bad' : 'text-ink')

/** "Dejó $ 45.000" / "Perdió $ 12.000" / "Salió hecho" */
export function resultPhrase(n: number): string {
  if (n > 0.004) return `Dejó ${nb(money(n, { decimals: 0 }))}`
  if (n < -0.004) return `Perdió ${nb(money(-n, { decimals: 0 }))}`
  return 'Salió hecho (ni ganó ni perdió)'
}

/**
 * Dos barritas: lo que entró (azul) vs. lo que costó (coral), en la misma escala.
 * Así se ve de un vistazo si el evento "volvió".
 */
export function MiniBars({ revenue, costs, className }: { revenue: number; costs: number; className?: string }) {
  const max = Math.max(revenue, costs, 1)
  const rows = [
    { label: 'Entró', value: revenue, color: CHART_COLORS.ventas },
    { label: 'Costó', value: costs, color: CHART_COLORS.gastos },
  ]
  return (
    <div className={clsx('space-y-1.5', className)}>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 text-[12.5px]">
          <span className="w-10 shrink-0 font-bold text-ink-soft">{r.label}</span>
          <span className="h-2 min-w-0 flex-1 rounded-full bg-cream-deep">
            <span className="block h-full rounded-full" style={{ width: `${r.value > 0 ? Math.max(3, (r.value / max) * 100) : 0}%`, background: r.color }} />
          </span>
          <span className="vh-num w-[6.5rem] shrink-0 text-right font-semibold text-ink">{money(r.value, { decimals: 0 })}</span>
        </div>
      ))}
    </div>
  )
}
