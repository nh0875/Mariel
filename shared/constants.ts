// Constantes del negocio compartidas entre el servidor y la interfaz.
// Todo lo que el usuario ve como "opción" (canales, medios de pago, tipos de vino…)
// sale de acá, así hay un único lugar para cambiar nombres.

export const WINE_TYPES = ['tinto', 'blanco', 'rosado', 'espumante', 'naranjo', 'dulce', 'otro'] as const
export type WineType = (typeof WINE_TYPES)[number]
export const WINE_TYPE_LABELS: Record<WineType, string> = {
  tinto: 'Tinto',
  blanco: 'Blanco',
  rosado: 'Rosado',
  espumante: 'Espumante',
  naranjo: 'Naranjo',
  dulce: 'Dulce / Cosecha tardía',
  otro: 'Otro',
}

export const VARIETALS = [
  'Malbec',
  'Cabernet Sauvignon',
  'Cabernet Franc',
  'Bonarda',
  'Merlot',
  'Syrah',
  'Pinot Noir',
  'Petit Verdot',
  'Tannat',
  'Criolla',
  'Blend',
  'Torrontés',
  'Chardonnay',
  'Sauvignon Blanc',
  'Semillón',
  'Viognier',
  'Pinot Grigio',
  'Chenin',
  'Moscatel',
  'Extra Brut',
  'Brut Nature',
  'Otro',
]

export const SALE_CHANNELS = ['local', 'online', 'mayorista', 'eventos', 'club', 'delivery', 'otro'] as const
export type SaleChannel = (typeof SALE_CHANNELS)[number]
export const SALE_CHANNEL_LABELS: Record<SaleChannel, string> = {
  local: 'Local / Tienda',
  online: 'Online / Redes',
  mayorista: 'Mayorista (restós, vinotecas)',
  eventos: 'Eventos y degustaciones',
  club: 'Club de vinos',
  delivery: 'Delivery / Apps',
  otro: 'Otro',
}

export const PRICE_LISTS = ['minorista', 'mayorista'] as const
export type PriceList = (typeof PRICE_LISTS)[number]
export const PRICE_LIST_LABELS: Record<PriceList, string> = {
  minorista: 'Precio minorista',
  mayorista: 'Precio mayorista',
}

export const PAYMENT_METHODS = ['efectivo', 'transferencia', 'debito', 'credito', 'mercadopago', 'otro'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  debito: 'Tarjeta de débito',
  credito: 'Tarjeta de crédito',
  mercadopago: 'Mercado Pago / QR',
  otro: 'Otro',
}

export const ACCOUNT_KINDS = ['efectivo', 'banco', 'billetera', 'otro'] as const
export type AccountKind = (typeof ACCOUNT_KINDS)[number]
export const ACCOUNT_KIND_LABELS: Record<AccountKind, string> = {
  efectivo: 'Efectivo (caja física)',
  banco: 'Cuenta bancaria',
  billetera: 'Billetera virtual',
  otro: 'Otra',
}

export const CLIENT_KINDS = ['consumidor', 'restaurante', 'vinoteca', 'empresa', 'distribuidor', 'otro'] as const
export type ClientKind = (typeof CLIENT_KINDS)[number]
export const CLIENT_KIND_LABELS: Record<ClientKind, string> = {
  consumidor: 'Consumidor final',
  restaurante: 'Restaurante / Bar',
  vinoteca: 'Vinoteca',
  empresa: 'Empresa (regalos corporativos)',
  distribuidor: 'Distribuidor',
  otro: 'Otro',
}

export const SUPPLIER_KINDS = ['bodega', 'distribuidor', 'insumos', 'servicios', 'logistica', 'otro'] as const
export type SupplierKind = (typeof SUPPLIER_KINDS)[number]
export const SUPPLIER_KIND_LABELS: Record<SupplierKind, string> = {
  bodega: 'Bodega',
  distribuidor: 'Distribuidor',
  insumos: 'Insumos y packaging',
  servicios: 'Servicios',
  logistica: 'Logística / Envíos',
  otro: 'Otro',
}

export const EVENT_KINDS = ['degustacion', 'feria', 'cata_privada', 'corporativo', 'maridaje', 'otro'] as const
export type EventKind = (typeof EVENT_KINDS)[number]
export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  degustacion: 'Degustación',
  feria: 'Feria / Expo',
  cata_privada: 'Cata privada',
  corporativo: 'Evento corporativo',
  maridaje: 'Cena maridaje',
  otro: 'Otro',
}

/**
 * Tipos de movimiento de stock.
 * - Entradas con costo propio: inicial, compra.
 * - Entradas al costo promedio: ajuste (+), devolucion.
 * - Salidas (al costo promedio del momento): venta, ajuste (−), rotura, degustacion, regalo, consumo.
 * - revaluo: no mueve botellas, fija un costo nuevo desde esa fecha.
 */
export const STOCK_MOVEMENT_KINDS = [
  'inicial',
  'compra',
  'venta',
  'ajuste',
  'rotura',
  'degustacion',
  'regalo',
  'consumo',
  'devolucion',
  'revaluo',
] as const
export type StockMovementKind = (typeof STOCK_MOVEMENT_KINDS)[number]
export const STOCK_MOVEMENT_LABELS: Record<StockMovementKind, string> = {
  inicial: 'Stock inicial',
  compra: 'Compra',
  venta: 'Venta',
  ajuste: 'Ajuste de inventario',
  rotura: 'Rotura / Pérdida',
  degustacion: 'Degustación (botella abierta)',
  regalo: 'Regalo / Muestra',
  consumo: 'Consumo interno',
  devolucion: 'Devolución de cliente',
  revaluo: 'Cambio de costo',
}
/** Movimientos que el usuario puede cargar a mano desde "Ajustar stock". */
export const MANUAL_STOCK_KINDS = ['ajuste', 'rotura', 'degustacion', 'regalo', 'consumo', 'devolucion'] as const
export type ManualStockKind = (typeof MANUAL_STOCK_KINDS)[number]
/** Salidas de stock que NO son ventas: se informan como "Mermas, degustaciones y regalos". */
export const SHRINKAGE_KINDS: StockMovementKind[] = ['ajuste', 'rotura', 'degustacion', 'regalo', 'consumo']

export const EXPENSE_NATURES = ['fijo', 'variable'] as const
export type ExpenseNature = (typeof EXPENSE_NATURES)[number]
export const EXPENSE_NATURE_LABELS: Record<ExpenseNature, string> = {
  fijo: 'Fijo (se paga igual vendas o no)',
  variable: 'Variable (depende de cuánto vendés)',
}

export const DEFAULT_EXPENSE_CATEGORIES: { name: string; nature: ExpenseNature }[] = [
  { name: 'Alquiler', nature: 'fijo' },
  { name: 'Sueldos y cargas sociales', nature: 'fijo' },
  { name: 'Servicios (luz, gas, agua, internet)', nature: 'fijo' },
  { name: 'Impuestos y tasas', nature: 'variable' },
  { name: 'Contador y honorarios', nature: 'fijo' },
  { name: 'Marketing y redes', nature: 'variable' },
  { name: 'Envíos y logística', nature: 'variable' },
  { name: 'Packaging (cajas, bolsas, etiquetas)', nature: 'variable' },
  { name: 'Software y suscripciones', nature: 'fijo' },
  { name: 'Bancos y comisiones', nature: 'variable' },
  { name: 'Seguros', nature: 'fijo' },
  { name: 'Mantenimiento y limpieza', nature: 'fijo' },
  { name: 'Eventos y degustaciones', nature: 'variable' },
  { name: 'Viáticos y movilidad', nature: 'variable' },
  { name: 'Otros', nature: 'variable' },
]

/** Movimientos de caja "sueltos" (no vienen de una venta, compra o gasto). */
export const MANUAL_CASH_KINDS = ['aporte', 'retiro', 'prestamo_recibido', 'prestamo_pagado', 'otro_ingreso', 'otro_egreso', 'ajuste'] as const
export type ManualCashKind = (typeof MANUAL_CASH_KINDS)[number]
export const MANUAL_CASH_LABELS: Record<ManualCashKind, string> = {
  aporte: 'Aporte de socios / dueños',
  retiro: 'Retiro de socios / dueños',
  prestamo_recibido: 'Préstamo recibido',
  prestamo_pagado: 'Pago de préstamo',
  otro_ingreso: 'Otro ingreso',
  otro_egreso: 'Otro egreso',
  ajuste: 'Ajuste de saldo (arqueo)',
}
/** Dirección por defecto de cada movimiento manual ("ajuste" puede ir para los dos lados). */
export const MANUAL_CASH_DIRECTION: Record<ManualCashKind, 'in' | 'out' | null> = {
  aporte: 'in',
  retiro: 'out',
  prestamo_recibido: 'in',
  prestamo_pagado: 'out',
  otro_ingreso: 'in',
  otro_egreso: 'out',
  ajuste: null,
}

/**
 * Qué puede originar un movimiento de caja (payments.ref_type).
 * sale/purchase/expense = cobro o pago de un comprobante.
 * sale_fee = comisión que se queda el medio de pago al cobrar una venta.
 * transfer = una pata de una transferencia entre cuentas.
 * El resto son los movimientos manuales (MANUAL_CASH_KINDS).
 */
export const PAYMENT_REF_TYPES = ['sale', 'purchase', 'expense', 'sale_fee', 'transfer', ...MANUAL_CASH_KINDS] as const
export type PaymentRefType = (typeof PAYMENT_REF_TYPES)[number]
export const PAYMENT_REF_LABELS: Record<PaymentRefType, string> = {
  sale: 'Cobro de venta',
  purchase: 'Pago de compra',
  expense: 'Pago de gasto',
  sale_fee: 'Comisión de cobro',
  transfer: 'Transferencia entre cuentas',
  ...MANUAL_CASH_LABELS,
}

export const PAYMENT_STATUSES = ['pagado', 'parcial', 'pendiente'] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

/** Paleta de la marca (sacada del logo VINOH!). */
export const BRAND = {
  cream: '#FDFAF5',
  coral: '#FD807E',
  mustard: '#EECB63',
  orange: '#F0953C',
  sky: '#7EB9E3',
  brown: '#A9520F',
  ink: '#3B2414',
}

/**
 * Colores para gráficos (validados para daltonismo, en este orden fijo).
 * Ventas/ingresos = azul, gastos/egresos = coral, costo del vino = mostaza,
 * ganancia = verde azulado. Nunca reasignar por ranking.
 */
export const CHART_COLORS = {
  ventas: '#3D8FCF',
  gastos: '#E8605E',
  costo: '#D9A520',
  extra: '#A8467A',
  envios: '#E07B1A',
  ganancia: '#2F9E8F',
} as const
export const CHART_SERIES = ['#3D8FCF', '#E8605E', '#D9A520', '#A8467A', '#E07B1A', '#2F9E8F'] as const
