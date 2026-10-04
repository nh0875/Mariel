// Tipos de datos compartidos entre servidor y cliente.
// Convenciones:
// - Fechas como texto 'YYYY-MM-DD' (fecha local, sin hora).
// - Plata como number en pesos (2 decimales), siempre el monto final que se pagó/cobró.
// - Booleanos de SQLite (0/1) se devuelven ya convertidos a true/false.

import type {
  AccountKind,
  ClientKind,
  EventKind,
  ExpenseNature,
  PaymentMethod,
  PaymentRefType,
  PaymentStatus,
  PriceList,
  SaleChannel,
  StockMovementKind,
  SupplierKind,
  WineType,
} from './constants'

export type ISODate = string // 'YYYY-MM-DD'

// ───────────────────────── Vinos y stock ─────────────────────────

export interface Product {
  id: number
  name: string
  winery: string | null // bodega
  varietal: string | null
  wine_type: WineType
  vintage: number | null // cosecha
  region: string | null
  size_ml: number
  sku: string | null
  /** Costo por botella actual (promedio ponderado de compras, ver services/stock.ts). */
  unit_cost: number
  price_retail: number
  price_wholesale: number
  /** Botellas en stock (calculado a partir de los movimientos). */
  stock: number
  min_stock: number
  units_per_box: number
  active: boolean
  notes: string | null
  created_at: string
  updated_at: string | null
}

export interface StockMovement {
  id: number
  product_id: number
  date: ISODate
  kind: StockMovementKind
  /** Con signo: + entra, − sale. */
  qty: number
  /** Costo por botella con el que se valorizó el movimiento. */
  unit_cost: number
  ref_type: 'sale_item' | 'purchase_item' | 'event' | null
  ref_id: number | null
  notes: string | null
  created_at: string
}

// ───────────────────────── Contactos ─────────────────────────

export interface Client {
  id: number
  name: string
  kind: ClientKind
  phone: string | null
  email: string | null
  tax_id: string | null // CUIT / DNI
  address: string | null
  city: string | null
  notes: string | null
  active: boolean
  created_at: string
}

export interface Supplier {
  id: number
  name: string
  kind: SupplierKind
  contact_name: string | null
  phone: string | null
  email: string | null
  tax_id: string | null
  address: string | null
  notes: string | null
  active: boolean
  created_at: string
}

// ───────────────────────── Ventas ─────────────────────────

export interface SaleItem {
  id: number
  sale_id: number
  /** null = ítem que no es un vino del stock (ej: "Entrada degustación", "Caja de regalo"). */
  product_id: number | null
  description: string | null
  qty: number
  unit_price: number
  /** Costo por botella al momento de la venta (CMV). 0 si no es un vino del stock. */
  unit_cost: number
}

export interface Sale {
  id: number
  date: ISODate
  client_id: number | null
  channel: SaleChannel
  price_list: PriceList
  payment_method: PaymentMethod
  /** Suma de los ítems (cantidad × precio). */
  subtotal: number
  /** Descuento en pesos. */
  discount: number
  /** Envío cobrado al cliente. */
  shipping: number
  /** Lo que paga el cliente: subtotal − descuento + envío. */
  total: number
  /** Comisión que cobra el medio de pago (Mercado Pago, tarjeta…). Es un costo. */
  fee: number
  due_date: ISODate | null
  event_id: number | null
  notes: string | null
  created_at: string
}

/** Venta con datos calculados, como la devuelven los listados. */
export interface SaleWithStatus extends Sale {
  client_name: string | null
  event_name: string | null
  items_count: number
  bottles: number
  /** Costo de la mercadería vendida (Σ qty × unit_cost). */
  cost: number
  /** Lo que te deja la venta: total − comisión − costo de las botellas. */
  profit: number
  paid: number
  balance: number
  status: PaymentStatus
  overdue: boolean
}

export interface SaleDetail extends SaleWithStatus {
  items: (SaleItem & { product_name: string | null })[]
  payments: Payment[]
}

// ───────────────────────── Compras ─────────────────────────

export interface PurchaseItem {
  id: number
  purchase_id: number
  product_id: number
  qty: number
  /** Precio por botella según factura. */
  unit_cost: number
  /** Costo real por botella: precio + parte proporcional del flete/otros costos. */
  landed_unit_cost: number
}

export interface Purchase {
  id: number
  date: ISODate
  supplier_id: number | null
  invoice_number: string | null
  /** Σ qty × unit_cost */
  subtotal: number
  /** Flete y otros costos de la compra (se reparten en el costo de cada botella). */
  shipping: number
  total: number
  due_date: ISODate | null
  notes: string | null
  created_at: string
}

export interface PurchaseWithStatus extends Purchase {
  supplier_name: string | null
  items_count: number
  bottles: number
  paid: number
  balance: number
  status: PaymentStatus
  overdue: boolean
}

export interface PurchaseDetail extends PurchaseWithStatus {
  items: (PurchaseItem & { product_name: string })[]
  payments: Payment[]
}

// ───────────────────────── Gastos ─────────────────────────

export interface Expense {
  id: number
  date: ISODate
  category: string
  description: string
  amount: number
  nature: ExpenseNature
  supplier_id: number | null
  due_date: ISODate | null
  event_id: number | null
  recurring_id: number | null
  notes: string | null
  created_at: string
}

export interface ExpenseWithStatus extends Expense {
  supplier_name: string | null
  event_name: string | null
  paid: number
  balance: number
  status: PaymentStatus
  overdue: boolean
}

export interface RecurringExpense {
  id: number
  description: string
  category: string
  amount: number
  nature: ExpenseNature
  day_of_month: number
  account_id: number | null
  /** Si es true, al generarlo se marca como pagado desde account_id. */
  auto_paid: boolean
  active: boolean
  created_at: string
}

// ───────────────────────── Caja ─────────────────────────

export interface Account {
  id: number
  name: string
  kind: AccountKind
  initial_balance: number
  active: boolean
  notes: string | null
  created_at: string
}

export interface AccountWithBalance extends Account {
  balance: number
  total_in: number
  total_out: number
}

export interface Payment {
  id: number
  date: ISODate
  account_id: number
  direction: 'in' | 'out'
  amount: number
  ref_type: PaymentRefType
  ref_id: number | null
  /** Agrupa las dos patas de una transferencia entre cuentas. */
  transfer_id: string | null
  description: string | null
  created_at: string
}

// ───────────────────────── Eventos, metas, inflación ─────────────────────────

export interface WineEvent {
  id: number
  name: string
  date: ISODate
  kind: EventKind
  location: string | null
  attendees: number | null
  ticket_price: number | null
  budget: number | null
  notes: string | null
  created_at: string
}

// Respuestas de /api/events (ver server/routes/events.ts).
/**
 * Las cuentas de un evento (GET /events, /events/:id):
 *   entradas + ventas de vino − costo del vino vendido − comisiones − gastos del evento − botellas abiertas.
 */
export interface EventSummary {
  /** Todo lo que se cobró en ventas asociadas al evento (total de cada venta). */
  revenue: number
  /** Parte de revenue que son entradas u otros ítems que no son vino del stock. */
  tickets: number
  /** Cantidad de entradas (unidades de ítems que no son vino). */
  tickets_qty: number
  /** revenue − tickets: lo que se vendió de vino (con descuentos y envíos repartidos). */
  wine_sales: number
  /** Costo de las botellas vendidas en el evento. */
  cogs: number
  /** Comisiones de cobro de esas ventas. */
  fees: number
  /** Gastos cargados con este evento. */
  expenses: number
  /** Botellas que salieron del stock para el evento sin venderse (degustación, regalos…). */
  bottles_opened: number
  /** Esas botellas valorizadas al costo promedio del momento. */
  bottles_opened_cost: number
  /** Botellas vendidas en las ventas del evento. */
  bottles_sold: number
  /** cogs + fees + expenses + bottles_opened_cost */
  costs: number
  /** Lo que pusiste para hacer el evento: gastos + botellas abiertas. */
  investment: number
  /** revenue − cogs − fees − expenses − bottles_opened_cost */
  result: number
  /** result ÷ personas (null si no se cargó cuánta gente fue). */
  per_attendee: number | null
  /** result ÷ (gastos + botellas abiertas) (null si no hubo inversión). */
  roi: number | null
  /** (gastos + botellas abiertas) ÷ presupuesto (null si no tiene presupuesto). */
  budget_used: number | null
  sales_count: number
  expenses_count: number
  /** Movimientos de stock asociados (para saber si se puede borrar el evento). */
  opened_count: number
}

export type EventWithSummary = WineEvent & { summary: EventSummary }

export interface OpenedBottle {
  id: number
  date: ISODate
  kind: StockMovementKind
  kind_label: string
  product_id: number
  product_name: string
  product_winery: string | null
  /** Botellas (positivo = salieron del stock). */
  bottles: number
  unit_cost: number
  /** bottles × unit_cost */
  cost: number
  notes: string | null
}

export type EventSale = SaleWithStatus & {
  /** "Entrada al evento ×24" / "Malbec Reserva ×2 +1". */
  items_label: string
  /** Parte de la venta que son entradas (para separar en la tabla). */
  tickets: number
}

export interface EventDetail {
  event: WineEvent
  summary: EventSummary
  sales: EventSale[]
  expenses: ExpenseWithStatus[]
  opened: OpenedBottle[]
  /** ¿Los clientes que compraron en el evento volvieron a comprar en los 30 días siguientes? */
  after: {
    days: number
    /** Clientes identificados que compraron en el evento. */
    clients: number
    /** Cuántos de ellos volvieron a comprar. */
    returning_clients: number
    sales_count: number
    revenue: number
    /** false si todavía no pasaron los 30 días. */
    complete: boolean
  }
  budget_used: number | null
}

export interface Goal {
  month: string // 'YYYY-MM'
  sales_target: number | null
  bottles_target: number | null
  expense_budget: number | null
  notes: string | null
}

export interface InflationRate {
  month: string // 'YYYY-MM'
  rate: number // % mensual (ej: 2.7)
}

// ───────────────────────── Configuración ─────────────────────────

export interface PaymentMethodSetting {
  key: PaymentMethod
  label: string
  /** % que se queda el medio de pago (ej: 6.29 para Mercado Pago). */
  fee_pct: number
  /** Cuenta donde entra la plata por defecto. */
  account_id: number | null
}

export interface ExpenseCategorySetting {
  name: string
  nature: ExpenseNature
}

export interface Settings {
  business: {
    name: string
    tagline: string
    owner: string
    tax_id: string
    address: string
    phone: string
    email: string
    fiscal_condition: 'monotributo' | 'responsable_inscripto' | 'otro'
  }
  payment_methods: PaymentMethodSetting[]
  expense_categories: ExpenseCategorySetting[]
  /** Cotización de referencia del dólar (para mostrar equivalentes en USD). */
  usd_rate: number
  usd_rate_date: ISODate | null
  pricing: {
    /** Margen objetivo sobre el precio de venta (%), usado por la calculadora. */
    target_margin_pct: number
    /** Descuento del precio mayorista respecto del minorista (%), como sugerencia. */
    wholesale_discount_pct: number
    iva_pct: number
    iibb_pct: number
  }
  defaults: {
    min_stock: number
    units_per_box: number
  }
  onboarding: {
    completed: boolean
    demo_loaded: boolean
  }
}

// ───────────────────────── Finanzas / reportes ─────────────────────────

/**
 * Resumen económico de un período (criterio "devengado": cuenta lo que se vendió
 * y gastó en el período, se haya cobrado/pagado o no). Ver services/finance.ts.
 */
export interface PeriodSummary {
  from: ISODate
  to: ISODate
  /** Ventas totales (lo que pagan los clientes, con descuentos y envíos). */
  sales: number
  sales_count: number
  bottles_sold: number
  /** Costo de las botellas vendidas (CMV). */
  cogs: number
  /** sales − cogs */
  gross_profit: number
  /** gross_profit / sales (0..1) */
  gross_margin: number
  /** Comisiones de medios de pago. */
  fees: number
  /** Botellas rotas, abiertas para degustar, regaladas, faltantes (valorizadas al costo). */
  shrinkage: number
  expenses: number
  expenses_fixed: number
  expenses_variable: number
  /** Resultado = gross_profit − fees − shrinkage − expenses */
  net_result: number
  /** net_result / sales (0..1) */
  net_margin: number
  avg_ticket: number
  /** Plata que entró y salió de las cuentas en el período (criterio "percibido"). */
  cash_in: number
  cash_out: number
  /** Compras de mercadería del período (no son gasto: son stock). */
  purchases: number
}

export interface MonthlyPoint extends PeriodSummary {
  month: string // 'YYYY-MM'
  label: string // 'ene 26'
}

/** Respuesta estándar de error de la API. */
export interface ApiError {
  error: string
  details?: unknown
}
