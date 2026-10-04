// Validaciones de los datos que entran al sistema (formularios → API).
// Se usan en el servidor para validar y en el cliente si se quiere validar antes de enviar.
import { z } from 'zod'
import {
  ACCOUNT_KINDS,
  CLIENT_KINDS,
  EVENT_KINDS,
  EXPENSE_NATURES,
  MANUAL_CASH_KINDS,
  MANUAL_STOCK_KINDS,
  PAYMENT_METHODS,
  PRICE_LISTS,
  SALE_CHANNELS,
  SUPPLIER_KINDS,
  WINE_TYPES,
} from './constants'

// Mensajes de error en castellano y sin tecnicismos.
z.setErrorMap((issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === 'undefined' || issue.received === 'null') return { message: 'es obligatorio' }
      if (issue.expected === 'number') return { message: 'tiene que ser un número' }
      return { message: 'tiene un formato inválido' }
    case z.ZodIssueCode.too_small:
      if (issue.type === 'string') return { message: issue.minimum === 1 ? 'es obligatorio' : `necesita al menos ${issue.minimum} caracteres` }
      if (issue.type === 'array') return { message: `necesita al menos ${issue.minimum} elemento(s)` }
      return { message: `tiene que ser ${issue.inclusive ? 'mayor o igual a' : 'mayor a'} ${issue.minimum}` }
    case z.ZodIssueCode.too_big:
      if (issue.type === 'string') return { message: `es demasiado largo (máx. ${issue.maximum} caracteres)` }
      return { message: `tiene que ser ${issue.inclusive ? 'menor o igual a' : 'menor a'} ${issue.maximum}` }
    case z.ZodIssueCode.invalid_enum_value:
      return { message: 'no es una opción válida' }
    default:
      return { message: ctx.defaultError }
  }
})

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'tiene que ser una fecha válida')
const month = z.string().regex(/^\d{4}-\d{2}$/, 'tiene que ser un mes válido (AAAA-MM)')
const optDate = date.nullish().transform((v) => v || null)
const optText = (max = 500) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => (v && v.trim() ? v.trim() : null))
const reqText = (max = 200) => z.string().trim().min(1).max(max)
const money = z.number().finite().min(0).max(1e12)
const optMoney = money.nullish().transform((v) => (v == null ? null : v))
const optId = z.number().int().positive().nullish().transform((v) => v ?? null)
const qty = z.number().int().min(1).max(1_000_000)

// ───────────── Vinos ─────────────
export const productInput = z.object({
  name: reqText(),
  winery: optText(120),
  varietal: optText(80),
  wine_type: z.enum(WINE_TYPES).default('tinto'),
  vintage: z.number().int().min(1900).max(2100).nullish().transform((v) => v ?? null),
  region: optText(120),
  size_ml: z.number().int().min(50).max(20000).default(750),
  sku: optText(60),
  price_retail: money.default(0),
  price_wholesale: money.default(0),
  min_stock: z.number().int().min(0).max(100000).default(6),
  units_per_box: z.number().int().min(1).max(48).default(6),
  active: z.boolean().default(true),
  notes: optText(2000),
  /** Solo al crear: costo por botella inicial. */
  unit_cost: money.optional(),
  /** Solo al crear: botellas que ya tenés. */
  initial_stock: z.number().int().min(0).max(1_000_000).optional(),
})
export type ProductInput = z.input<typeof productInput>

export const stockAdjustInput = z.object({
  date,
  kind: z.enum(MANUAL_STOCK_KINDS),
  /** Para "ajuste" puede ser negativo (faltan botellas) o positivo (sobran). Para el resto, botellas que salen/entran. */
  qty: z.number().int().refine((v) => v !== 0, 'no puede ser cero'),
  event_id: optId,
  notes: optText(500),
})
export type StockAdjustInput = z.input<typeof stockAdjustInput>

export const costChangeInput = z.object({
  date,
  unit_cost: money,
  notes: optText(500),
})

export const bulkPriceInput = z.object({
  /** % de aumento (negativo = baja). */
  percent: z.number().min(-90).max(1000),
  apply_to: z.enum(['retail', 'wholesale', 'both']).default('both'),
  product_ids: z.array(z.number().int().positive()).optional(),
  winery: optText(120),
  wine_type: z.enum(WINE_TYPES).nullish(),
  /** Redondear al múltiplo (ej: 100 → $12.345 queda $12.400). 0 = sin redondeo. */
  round_to: z.number().int().min(0).max(100000).default(0),
})

// ───────────── Contactos ─────────────
export const clientInput = z.object({
  name: reqText(),
  kind: z.enum(CLIENT_KINDS).default('consumidor'),
  phone: optText(60),
  email: optText(120),
  tax_id: optText(30),
  address: optText(200),
  city: optText(100),
  notes: optText(2000),
  active: z.boolean().default(true),
})
export type ClientInput = z.input<typeof clientInput>

export const supplierInput = z.object({
  name: reqText(),
  kind: z.enum(SUPPLIER_KINDS).default('bodega'),
  contact_name: optText(120),
  phone: optText(60),
  email: optText(120),
  tax_id: optText(30),
  address: optText(200),
  notes: optText(2000),
  active: z.boolean().default(true),
})
export type SupplierInput = z.input<typeof supplierInput>

// ───────────── Ventas ─────────────
export const saleItemInput = z
  .object({
    product_id: optId,
    description: optText(200),
    qty,
    unit_price: money,
  })
  .refine((v) => v.product_id != null || !!v.description, {
    message: 'elegí un vino o escribí una descripción',
    path: ['product_id'],
  })

export const saleInput = z.object({
  date,
  client_id: optId,
  channel: z.enum(SALE_CHANNELS).default('local'),
  price_list: z.enum(PRICE_LISTS).default('minorista'),
  payment_method: z.enum(PAYMENT_METHODS).default('efectivo'),
  items: z.array(saleItemInput).min(1),
  discount: money.default(0),
  shipping: money.default(0),
  /** Si no viene, se calcula con el % del medio de pago configurado. */
  fee: optMoney,
  due_date: optDate,
  event_id: optId,
  notes: optText(2000),
  /** ¿Ya lo cobraste? Si es true se registra el cobro completo en la cuenta indicada. */
  paid: z.boolean().default(true),
  account_id: optId,
})
export type SaleInput = z.input<typeof saleInput>

// ───────────── Compras ─────────────
export const purchaseItemInput = z.object({
  product_id: z.number().int().positive(),
  qty,
  unit_cost: money,
})

export const purchaseInput = z.object({
  date,
  supplier_id: optId,
  invoice_number: optText(60),
  items: z.array(purchaseItemInput).min(1),
  shipping: money.default(0),
  due_date: optDate,
  notes: optText(2000),
  paid: z.boolean().default(true),
  account_id: optId,
})
export type PurchaseInput = z.input<typeof purchaseInput>

// ───────────── Gastos ─────────────
export const expenseInput = z.object({
  date,
  category: reqText(80),
  description: reqText(200),
  amount: money.refine((v) => v > 0, 'tiene que ser mayor a 0'),
  nature: z.enum(EXPENSE_NATURES).default('variable'),
  supplier_id: optId,
  due_date: optDate,
  event_id: optId,
  notes: optText(2000),
  paid: z.boolean().default(true),
  account_id: optId,
})
export type ExpenseInput = z.input<typeof expenseInput>

export const recurringExpenseInput = z.object({
  description: reqText(200),
  category: reqText(80),
  amount: money.refine((v) => v > 0, 'tiene que ser mayor a 0'),
  nature: z.enum(EXPENSE_NATURES).default('fijo'),
  day_of_month: z.number().int().min(1).max(28).default(10),
  account_id: optId,
  auto_paid: z.boolean().default(false),
  active: z.boolean().default(true),
})
export type RecurringExpenseInput = z.input<typeof recurringExpenseInput>

// ───────────── Caja ─────────────
export const accountInput = z.object({
  name: reqText(80),
  kind: z.enum(ACCOUNT_KINDS).default('efectivo'),
  initial_balance: z.number().finite().default(0),
  active: z.boolean().default(true),
  notes: optText(500),
})
export type AccountInput = z.input<typeof accountInput>

/** Cobro de una venta o pago de una compra/gasto (puede ser parcial). */
export const settlementInput = z.object({
  date,
  amount: money.refine((v) => v > 0, 'tiene que ser mayor a 0'),
  account_id: z.number().int().positive(),
  description: optText(200),
})
export type SettlementInput = z.input<typeof settlementInput>

export const manualCashInput = z.object({
  date,
  kind: z.enum(MANUAL_CASH_KINDS),
  direction: z.enum(['in', 'out']),
  amount: money.refine((v) => v > 0, 'tiene que ser mayor a 0'),
  account_id: z.number().int().positive(),
  description: optText(200),
})
export type ManualCashInput = z.input<typeof manualCashInput>

export const transferInput = z
  .object({
    date,
    from_account_id: z.number().int().positive(),
    to_account_id: z.number().int().positive(),
    amount: money.refine((v) => v > 0, 'tiene que ser mayor a 0'),
    description: optText(200),
  })
  .refine((v) => v.from_account_id !== v.to_account_id, {
    message: 'elegí dos cuentas distintas',
    path: ['to_account_id'],
  })
export type TransferInput = z.input<typeof transferInput>

// ───────────── Eventos, metas, inflación ─────────────
export const eventInput = z.object({
  name: reqText(),
  date,
  kind: z.enum(EVENT_KINDS).default('degustacion'),
  location: optText(200),
  attendees: z.number().int().min(0).max(100000).nullish().transform((v) => v ?? null),
  ticket_price: optMoney,
  budget: optMoney,
  notes: optText(2000),
})
export type EventInput = z.input<typeof eventInput>

export const goalInput = z.object({
  month,
  sales_target: optMoney,
  bottles_target: z.number().int().min(0).nullish().transform((v) => v ?? null),
  expense_budget: optMoney,
  notes: optText(500),
})
export type GoalInput = z.input<typeof goalInput>

export const inflationInput = z.object({
  month,
  rate: z.number().min(-50).max(500),
})

// ───────────── Configuración ─────────────
export const settingsInput = z
  .object({
    business: z
      .object({
        name: z.string().max(120),
        tagline: z.string().max(200),
        owner: z.string().max(120),
        tax_id: z.string().max(30),
        address: z.string().max(200),
        phone: z.string().max(60),
        email: z.string().max(120),
        fiscal_condition: z.enum(['monotributo', 'responsable_inscripto', 'otro']),
      })
      .partial(),
    payment_methods: z.array(
      z.object({
        key: z.enum(PAYMENT_METHODS),
        label: z.string().min(1).max(60),
        fee_pct: z.number().min(0).max(50),
        account_id: z.number().int().positive().nullable(),
      }),
    ),
    expense_categories: z.array(z.object({ name: reqText(80), nature: z.enum(EXPENSE_NATURES) })).min(1),
    usd_rate: z.number().min(0).max(1e7),
    usd_rate_date: optDate,
    pricing: z
      .object({
        target_margin_pct: z.number().min(0).max(95),
        wholesale_discount_pct: z.number().min(0).max(90),
        iva_pct: z.number().min(0).max(50),
        iibb_pct: z.number().min(0).max(20),
      })
      .partial(),
    defaults: z
      .object({ min_stock: z.number().int().min(0), units_per_box: z.number().int().min(1).max(48) })
      .partial(),
    onboarding: z.object({ completed: z.boolean(), demo_loaded: z.boolean() }).partial(),
  })
  .partial()
export type SettingsInput = z.input<typeof settingsInput>
