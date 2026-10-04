// Utilidades para las rutas de la API: errores amigables, validación y filtros comunes.
import type { ErrorRequestHandler, Request } from 'express'
import { ZodError, type ZodTypeAny, type z } from 'zod'
import { endOfMonth, startOfMonth, today } from '../../shared/dates'

/** Error con código HTTP y mensaje pensado para mostrarle al usuario. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message)
  }
}

export const notFound = (what = 'el registro') => new HttpError(404, `No encontramos ${what}. Puede que se haya borrado.`)
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details)

// Nombres "humanos" de los campos para los mensajes de validación.
const FIELD_LABELS: Record<string, string> = {
  name: 'Nombre',
  date: 'Fecha',
  amount: 'Monto',
  qty: 'Cantidad',
  unit_price: 'Precio',
  unit_cost: 'Costo',
  product_id: 'Vino',
  items: 'Productos',
  category: 'Categoría',
  description: 'Descripción',
  account_id: 'Cuenta',
  to_account_id: 'Cuenta destino',
  from_account_id: 'Cuenta origen',
  price_retail: 'Precio minorista',
  price_wholesale: 'Precio mayorista',
  month: 'Mes',
  rate: 'Inflación',
  percent: 'Porcentaje',
  email: 'Email',
  kind: 'Tipo',
  day_of_month: 'Día del mes',
}

export function zodMessage(err: ZodError): string {
  const parts = err.issues.slice(0, 4).map((i) => {
    const pathParts = i.path.filter((p) => typeof p === 'string') as string[]
    const field = pathParts.length ? FIELD_LABELS[pathParts[pathParts.length - 1]] || pathParts[pathParts.length - 1] : ''
    const row = i.path.find((p) => typeof p === 'number')
    const where = row != null ? ` (renglón ${Number(row) + 1})` : ''
    return field ? `${field}${where}: ${i.message}` : i.message
  })
  return `Revisá estos datos → ${parts.join(' · ')}`
}

/** Valida el body (u otro objeto) con un esquema zod. Si falla, tira un 400 con mensaje claro. */
export function validate<S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data)
  if (!r.success) throw new HttpError(400, zodMessage(r.error), r.error.issues)
  return r.data
}

/** Lee un :id numérico de la URL. */
export function parseId(value: unknown, what = 'el registro'): number {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw notFound(what)
  return id
}

const ISO = /^\d{4}-\d{2}-\d{2}$/
/**
 * Lee ?from=YYYY-MM-DD&to=YYYY-MM-DD. Si no vienen, usa el mes actual.
 * Ambos extremos son inclusivos.
 */
export function parsePeriod(req: Request, defaults?: { from: string; to: string }) {
  const q = req.query as Record<string, string | undefined>
  const t = today()
  const from = q.from && ISO.test(q.from) ? q.from : defaults?.from ?? startOfMonth(t)
  const to = q.to && ISO.test(q.to) ? q.to : defaults?.to ?? endOfMonth(t)
  return from <= to ? { from, to } : { from: to, to: from }
}

/** Lee un parámetro de texto opcional de la query. */
export function qs(req: Request, key: string): string | undefined {
  const v = (req.query as Record<string, unknown>)[key]
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined
}

/** Lee un parámetro numérico opcional de la query. */
export function qn(req: Request, key: string): number | undefined {
  const v = qs(req, key)
  if (v == null) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details })
    return
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: zodMessage(err), details: err.issues })
    return
  }
  const msg = String(err?.message || err)
  if (msg.includes('FOREIGN KEY constraint failed')) {
    res.status(409).json({
      error: 'No se puede borrar porque tiene movimientos asociados (ventas, compras, pagos…). Probá desactivarlo en vez de borrarlo.',
    })
    return
  }
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: 'El archivo es demasiado grande.' })
    return
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Los datos enviados no tienen un formato válido.' })
    return
  }
  console.error('[VINOH] Error inesperado:', err)
  res.status(500).json({ error: 'Uy, algo salió mal en el sistema. Probá de nuevo; si sigue pasando, reiniciá el programa.' })
}
