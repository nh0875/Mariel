// Datos de ejemplo: 14 meses de una vinoteca ficticia, para probar el sistema sin miedo.
// Todo es inventado (bodegas, clientes, montos). Se genera siempre igual (semilla fija)
// y usa los mismos servicios que la carga real, así los números cierran igual que en la vida real.
import { all, run, tx } from '../db'
import { addDays, addMonths, endOfMonth, monthKey, monthsBetween, parseISODate, startOfMonth, today as todayFn } from '../../shared/dates'
import { round2, roundUpTo } from '../../shared/calc'
import type { PaymentMethod, SaleChannel, WineType } from '../../shared/constants'
import { ensureBaseData, wipeAllData } from '../services/setup'
import { getSettings, updateSettings } from '../services/settings'
import { addMovement } from '../services/stock'
import { createSale } from '../services/sales'
import { createPurchase } from '../services/purchases'
import { createExpense } from '../services/expenses'
import { addPayment, addSettlement, addTransfer, paidFor } from '../services/payments'

// PRNG determinístico (mulberry32)
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface WineSeed {
  name: string
  winery: number // índice de bodega
  varietal: string
  type: WineType
  vintage: number
  region: string
  cost: number // costo actual por botella
  margin: number // margen objetivo sobre precio
  popularity: number // peso relativo en ventas
  min: number
}

const WINERIES = [
  { name: 'Bodega Los Cerros', region: 'Valle de Uco, Mendoza', contact: 'Martín Aguirre' },
  { name: 'Finca La Escondida', region: 'Luján de Cuyo, Mendoza', contact: 'Carolina Ruiz' },
  { name: 'Cava del Valle', region: 'Cafayate, Salta', contact: 'Javier Cruz' },
  { name: 'Viñas del Sur', region: 'Alto Valle, Río Negro', contact: 'Ana Bertolini' },
  { name: 'Bodega Piedra Blanca', region: 'Valle de Pedernal, San Juan', contact: 'Hernán Videla' },
  { name: 'Distribuidora Andes Vinos', region: 'Mendoza', contact: 'Paula Quiroga' },
]

const SERVICE_SUPPLIERS = [
  { name: 'Envíos Rayo SRL', kind: 'logistica', contact: 'Mesa de ayuda' },
  { name: 'Cartonera del Sur', kind: 'insumos', contact: 'Ventas' },
  { name: 'Estudio Contable Pereyra', kind: 'servicios', contact: 'Lic. Silvia Pereyra' },
  { name: 'Inmobiliaria Centro', kind: 'servicios', contact: 'Administración' },
]

const WINES: WineSeed[] = [
  { name: 'Malbec Clásico', winery: 0, varietal: 'Malbec', type: 'tinto', vintage: 2023, region: 'Valle de Uco', cost: 7200, margin: 0.42, popularity: 14, min: 18 },
  { name: 'Malbec Reserva', winery: 0, varietal: 'Malbec', type: 'tinto', vintage: 2021, region: 'Valle de Uco', cost: 13500, margin: 0.42, popularity: 9, min: 12 },
  { name: 'Gran Malbec Parcela 7', winery: 0, varietal: 'Malbec', type: 'tinto', vintage: 2020, region: 'Gualtallary', cost: 34000, margin: 0.4, popularity: 2, min: 4 },
  { name: 'Cabernet Franc', winery: 0, varietal: 'Cabernet Franc', type: 'tinto', vintage: 2022, region: 'Valle de Uco', cost: 15800, margin: 0.42, popularity: 5, min: 6 },
  { name: 'Blend de Tintas', winery: 1, varietal: 'Blend', type: 'tinto', vintage: 2021, region: 'Luján de Cuyo', cost: 18900, margin: 0.41, popularity: 4, min: 6 },
  { name: 'Cabernet Sauvignon', winery: 1, varietal: 'Cabernet Sauvignon', type: 'tinto', vintage: 2022, region: 'Luján de Cuyo', cost: 9800, margin: 0.42, popularity: 6, min: 12 },
  { name: 'Bonarda Joven', winery: 1, varietal: 'Bonarda', type: 'tinto', vintage: 2024, region: 'Este mendocino', cost: 5600, margin: 0.44, popularity: 7, min: 12 },
  { name: 'Chardonnay Barrica', winery: 1, varietal: 'Chardonnay', type: 'blanco', vintage: 2023, region: 'Tupungato', cost: 12400, margin: 0.42, popularity: 4, min: 6 },
  { name: 'Rosé de Malbec', winery: 1, varietal: 'Malbec', type: 'rosado', vintage: 2024, region: 'Luján de Cuyo', cost: 7400, margin: 0.43, popularity: 5, min: 6 },
  { name: 'Torrontés de Altura', winery: 2, varietal: 'Torrontés', type: 'blanco', vintage: 2024, region: 'Cafayate', cost: 6900, margin: 0.43, popularity: 8, min: 12 },
  { name: 'Tannat Calchaquí', winery: 2, varietal: 'Tannat', type: 'tinto', vintage: 2021, region: 'Cafayate', cost: 14200, margin: 0.42, popularity: 3, min: 6 },
  { name: 'Malbec de Altura', winery: 2, varietal: 'Malbec', type: 'tinto', vintage: 2022, region: 'Cafayate', cost: 11900, margin: 0.42, popularity: 6, min: 12 },
  { name: 'Cosecha Tardía Torrontés', winery: 2, varietal: 'Torrontés', type: 'dulce', vintage: 2023, region: 'Cafayate', cost: 8700, margin: 0.44, popularity: 2, min: 4 },
  { name: 'Pinot Noir Patagonia', winery: 3, varietal: 'Pinot Noir', type: 'tinto', vintage: 2022, region: 'Río Negro', cost: 16900, margin: 0.42, popularity: 4, min: 6 },
  { name: 'Merlot del Río', winery: 3, varietal: 'Merlot', type: 'tinto', vintage: 2022, region: 'Río Negro', cost: 10600, margin: 0.42, popularity: 3, min: 6 },
  { name: 'Sauvignon Blanc Frío', winery: 3, varietal: 'Sauvignon Blanc', type: 'blanco', vintage: 2024, region: 'Río Negro', cost: 9400, margin: 0.43, popularity: 5, min: 6 },
  { name: 'Extra Brut Método Tradicional', winery: 3, varietal: 'Extra Brut', type: 'espumante', vintage: 2022, region: 'Río Negro', cost: 15300, margin: 0.42, popularity: 5, min: 6 },
  { name: 'Syrah de Pedernal', winery: 4, varietal: 'Syrah', type: 'tinto', vintage: 2021, region: 'Pedernal', cost: 12900, margin: 0.42, popularity: 3, min: 6 },
  { name: 'Criolla Rústica', winery: 4, varietal: 'Criolla', type: 'tinto', vintage: 2024, region: 'San Juan', cost: 6400, margin: 0.45, popularity: 4, min: 6 },
  { name: 'Naranjo de Chenin', winery: 4, varietal: 'Chenin', type: 'naranjo', vintage: 2023, region: 'San Juan', cost: 11200, margin: 0.43, popularity: 2, min: 4 },
  { name: 'Viognier Fresco', winery: 4, varietal: 'Viognier', type: 'blanco', vintage: 2024, region: 'San Juan', cost: 7800, margin: 0.43, popularity: 2, min: 6 },
  { name: 'Brut Nature Rosé', winery: 5, varietal: 'Brut Nature', type: 'espumante', vintage: 2023, region: 'Mendoza', cost: 11800, margin: 0.42, popularity: 4, min: 6 },
  { name: 'Malbec Orgánico', winery: 5, varietal: 'Malbec', type: 'tinto', vintage: 2023, region: 'Maipú', cost: 8900, margin: 0.43, popularity: 6, min: 12 },
  { name: 'Petit Verdot Edición Limitada', winery: 5, varietal: 'Petit Verdot', type: 'tinto', vintage: 2020, region: 'Maipú', cost: 22500, margin: 0.4, popularity: 1, min: 3 },
  { name: 'Semillón Viejas Viñas', winery: 5, varietal: 'Semillón', type: 'blanco', vintage: 2022, region: 'Valle de Uco', cost: 14800, margin: 0.42, popularity: 2, min: 4 },
]

const CONSUMERS = [
  'Lucía Fernández', 'Martín Gómez', 'Sofía Díaz', 'Joaquín Romero', 'Valentina Sosa', 'Tomás Álvarez', 'Camila Torres',
  'Federico Ruiz', 'Agustina Ramírez', 'Nicolás Acosta', 'Julieta Benítez', 'Matías Medina', 'Florencia Herrera',
  'Santiago Aguirre', 'Micaela Pereyra', 'Diego Castro', 'Rocío Molina', 'Pablo Ortiz', 'Belén Silva', 'Gonzalo Rojas',
]
const BUSINESS_CLIENTS: { name: string; kind: 'restaurante' | 'vinoteca' | 'empresa' | 'distribuidor'; city: string }[] = [
  { name: 'Bistró La Esquina', kind: 'restaurante', city: 'CABA' },
  { name: 'Parrilla Don Tito', kind: 'restaurante', city: 'Vicente López' },
  { name: 'Bar de Tapas Olivo', kind: 'restaurante', city: 'Palermo' },
  { name: 'Vinoteca El Corcho', kind: 'vinoteca', city: 'La Plata' },
  { name: 'Almacén Gourmet Sabores', kind: 'vinoteca', city: 'San Isidro' },
  { name: 'Estudio Jurídico Ramos & Asoc.', kind: 'empresa', city: 'CABA' },
  { name: 'Consultora Nexo', kind: 'empresa', city: 'CABA' },
]

const EVENTS = [
  { monthsAgo: 12, day: 20, name: 'Degustación de Malbecs de altura', kind: 'degustacion', attendees: 24, ticket: 9000, location: 'En el local' },
  { monthsAgo: 10, day: 14, name: 'Feria de Vinos de Barrio', kind: 'feria', attendees: 180, ticket: 0, location: 'Plaza del barrio' },
  { monthsAgo: 9, day: 18, name: 'Cena maridaje con Bistró La Esquina', kind: 'maridaje', attendees: 30, ticket: 28000, location: 'Bistró La Esquina' },
  { monthsAgo: 7, day: 12, name: 'Cata a ciegas: ¿Malbec o Cabernet?', kind: 'cata_privada', attendees: 16, ticket: 12000, location: 'En el local' },
  { monthsAgo: 5, day: 22, name: 'Degustación de blancos y espumantes', kind: 'degustacion', attendees: 28, ticket: 10000, location: 'En el local' },
  { monthsAgo: 3, day: 9, name: 'Regalos empresariales Consultora Nexo', kind: 'corporativo', attendees: 60, ticket: 0, location: 'Oficinas del cliente' },
  { monthsAgo: 1, day: 19, name: 'Noche de vinos patagónicos', kind: 'degustacion', attendees: 26, ticket: 14000, location: 'En el local' },
]

// Inflación mensual de referencia (inventada, en el orden de los meses del período).
const INFLATION_PATH = [2.1, 2.3, 2.0, 2.4, 2.7, 2.2, 2.0, 1.9, 2.3, 2.1, 1.8, 2.0, 2.2, 1.9]

export function loadDemoData(ref: string = todayFn()): { sales: number; purchases: number; expenses: number } {
  const r = rng(20260104)
  const rand = (a: number, b: number) => a + r() * (b - a)
  const randInt = (a: number, b: number) => Math.floor(rand(a, b + 1))
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]
  const weighted = <T,>(xs: T[], w: (x: T) => number) => {
    const total = xs.reduce((s, x) => s + w(x), 0)
    let t = r() * total
    for (const x of xs) {
      t -= w(x)
      if (t <= 0) return x
    }
    return xs[xs.length - 1]
  }

  const start = addMonths(startOfMonth(ref), -13)
  const months = monthsBetween(start, ref)
  const lastDay = ref
  // Factor de precios: hoy = 1; hace n meses ≈ 1 / Π(1+inflación).
  const priceFactor = new Map<string, number>()
  {
    let f = 1
    for (let i = months.length - 1; i >= 0; i--) {
      priceFactor.set(months[i], f)
      f = f / (1 + INFLATION_PATH[i] / 100)
    }
  }
  const pf = (d: string) => priceFactor.get(monthKey(d)) ?? 1

  let counts = { sales: 0, purchases: 0, expenses: 0 }

  tx(() => {
    wipeAllData()
    ensureBaseData()
    const accounts = all<{ id: number; kind: string }>('SELECT id, kind FROM accounts ORDER BY id')
    const caja = accounts.find((a) => a.kind === 'efectivo')!.id
    const banco = accounts.find((a) => a.kind === 'banco')!.id
    const mp = accounts.find((a) => a.kind === 'billetera')!.id
    run('UPDATE accounts SET initial_balance = ? WHERE id = ?', [180000, caja])
    run('UPDATE accounts SET initial_balance = ? WHERE id = ?', [4800000, banco])
    run('UPDATE accounts SET initial_balance = ? WHERE id = ?', [250000, mp])

    const s = getSettings()
    updateSettings({
      business: { ...s.business, name: 'VINOH!', tagline: 'Viví el vino', owner: 'Mariel', email: 'hola@vinoh.com.ar', phone: '11 5555-0101', address: 'Av. Siempreviva 742, CABA' },
      usd_rate: 1450,
      usd_rate_date: ref,
      onboarding: { completed: true, demo_loaded: true },
    })

    // Proveedores
    const wineryIds = WINERIES.map(
      (w) =>
        run('INSERT INTO suppliers (name, kind, contact_name, phone, email, address, notes) VALUES (?, ?, ?, ?, ?, ?, ?)', [
          w.name,
          w === WINERIES[5] ? 'distribuidor' : 'bodega',
          w.contact,
          `261 4${randInt(100, 999)}-${randInt(1000, 9999)}`,
          `ventas@${w.name.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')}.com.ar`,
          w.region,
          'Proveedor de ejemplo',
        ]).lastInsertRowid,
    )
    const serviceIds = SERVICE_SUPPLIERS.map(
      (sv) => run('INSERT INTO suppliers (name, kind, contact_name, notes) VALUES (?, ?, ?, ?)', [sv.name, sv.kind, sv.contact, 'Proveedor de ejemplo']).lastInsertRowid,
    )
    const [envios, cartonera, contador, inmobiliaria] = serviceIds

    // Vinos (con stock inicial al comienzo del período, al costo de ese momento)
    const products = WINES.map((w) => {
      const price = roundUpTo(w.cost / (1 - w.margin), 100)
      const id = run(
        `INSERT INTO products (name, winery, varietal, wine_type, vintage, region, size_ml, sku, price_retail, price_wholesale, min_stock, units_per_box, notes)
         VALUES (?, ?, ?, ?, ?, ?, 750, ?, ?, ?, ?, 6, ?)`,
        [
          w.name,
          WINERIES[w.winery].name,
          w.varietal,
          w.type,
          w.vintage,
          w.region,
          `VH-${String(WINES.indexOf(w) + 1).padStart(3, '0')}`,
          price,
          roundUpTo(price * 0.82, 100),
          w.min,
          w.popularity >= 8 ? 'Uno de los más vendidos.' : null,
        ],
      ).lastInsertRowid
      const initial = Math.max(w.min * 2, Math.round(w.popularity * 4))
      addMovement({ product_id: id, date: start, kind: 'inicial', qty: initial, unit_cost: round2(w.cost * pf(start)) }, { recalc: true })
      return { ...w, id, price, stockSim: initial }
    })

    // Clientes
    const consumerIds = CONSUMERS.map(
      (n) =>
        run('INSERT INTO clients (name, kind, phone, email, city) VALUES (?, ?, ?, ?, ?)', [
          n,
          'consumidor',
          `11 ${randInt(2000, 6999)}-${randInt(1000, 9999)}`,
          `${n.split(' ')[0].toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')}@mail.com`,
          pick(['CABA', 'Vicente López', 'San Isidro', 'Olivos', 'Martínez']),
        ]).lastInsertRowid,
    )
    const bizClients = BUSINESS_CLIENTS.map((c) => ({
      ...c,
      id: run('INSERT INTO clients (name, kind, city, tax_id, notes) VALUES (?, ?, ?, ?, ?)', [
        c.name,
        c.kind,
        c.city,
        `30-${randInt(10000000, 79999999)}-${randInt(1, 9)}`,
        c.kind === 'empresa' ? 'Compra cajas para regalos de fin de año.' : 'Cliente mayorista. Paga a 15/30 días.',
      ]).lastInsertRowid,
    }))
    const clubMembers = consumerIds.slice(0, 9)

    // Eventos
    const eventRows = EVENTS.map((e) => {
      const m = addMonths(startOfMonth(ref), -e.monthsAgo)
      let date = `${monthKey(m)}-${String(e.day).padStart(2, '0')}`
      // Los domingos el local está cerrado en la simulación: el evento pasa al sábado.
      if (parseISODate(date).getDay() === 0) date = addDays(date, -1)
      const id = run('INSERT INTO events (name, date, kind, location, attendees, ticket_price, budget, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
        e.name,
        date,
        e.kind,
        e.location,
        e.attendees,
        e.ticket ? round2(e.ticket * pf(date)) : null,
        round2(180000 * pf(date)),
        'Evento de ejemplo',
      ]).lastInsertRowid
      return { ...e, id, date }
    })
    const eventByDate = new Map(eventRows.map((e) => [e.date, e]))

    // Inflación y metas
    months.forEach((m, i) => run('INSERT INTO inflation (month, rate) VALUES (?, ?)', [m, INFLATION_PATH[i]]))

    // Gastos fijos (plantillas) — se cargan como gasto cada mes con el monto ajustado por inflación
    const fixed = [
      { description: 'Alquiler del local', category: 'Alquiler', amount: 720000, day: 5, account: banco, supplier: inmobiliaria },
      { description: 'Sueldo encargada de tienda', category: 'Sueldos y cargas sociales', amount: 980000, day: 4, account: banco, supplier: null },
      { description: 'Cargas sociales (F.931)', category: 'Sueldos y cargas sociales', amount: 290000, day: 10, account: banco, supplier: null },
      { description: 'Luz, gas y agua', category: 'Servicios (luz, gas, agua, internet)', amount: 98000, day: 15, account: banco, supplier: null },
      { description: 'Internet y teléfono', category: 'Servicios (luz, gas, agua, internet)', amount: 38000, day: 12, account: mp, supplier: null },
      { description: 'Honorarios del contador', category: 'Contador y honorarios', amount: 135000, day: 8, account: banco, supplier: contador },
      { description: 'Tienda online y sistema de cobros', category: 'Software y suscripciones', amount: 52000, day: 3, account: mp, supplier: null },
      { description: 'Seguro integral del comercio', category: 'Seguros', amount: 41000, day: 20, account: banco, supplier: null },
    ]
    const recurringIds = fixed.map(
      (f) =>
        run('INSERT INTO recurring_expenses (description, category, amount, nature, day_of_month, account_id, auto_paid) VALUES (?, ?, ?, ?, ?, ?, 1)', [
          f.description,
          f.category,
          f.amount,
          'fijo',
          f.day,
          f.account,
        ]).lastInsertRowid,
    )

    // ── Simulación día por día ──
    const pendingPurchases: { id: number; due: string; account: number }[] = []
    const pendingSales: { id: number; due: string; account: number; skip: boolean }[] = []
    const monthSales = new Map<string, number>()
    const methodAccount: Record<PaymentMethod, number> = { efectivo: caja, transferencia: banco, debito: banco, credito: banco, mercadopago: mp, otro: caja }

    for (let d = start; d <= lastDay; d = addDays(d, 1)) {
      const dt = parseISODate(d)
      const dow = dt.getDay() // 0 domingo
      const m = monthKey(d)
      const dom = dt.getDate()
      const monthIdx = dt.getMonth()
      const f = pf(d)

      // Gastos fijos del mes
      fixed.forEach((fx, i) => {
        if (dom === fx.day) {
          // Para el ejemplo: el contador de este mes y el seguro del mes pasado quedan sin pagar.
          const unpaid =
            (fx.supplier === contador && m === monthKey(ref)) || (fx.category === 'Seguros' && m === monthKey(addMonths(startOfMonth(ref), -1)))
          createExpense({
            date: d,
            category: fx.category,
            description: fx.description,
            amount: roundUpTo(fx.amount * f, 100),
            nature: 'fijo',
            supplier_id: fx.supplier,
            due_date: unpaid ? addDays(d, 10) : d,
            event_id: null,
            notes: null,
            paid: !unpaid,
            account_id: fx.account,
            recurring_id: recurringIds[i],
          })
          counts.expenses++
        }
      })

      // Retiro de los dueños, transferencia MP → Banco
      if (dom === 28) {
        addPayment({ date: d, account_id: banco, direction: 'out', amount: roundUpTo(450000 * f, 1000), ref_type: 'retiro', description: 'Retiro de socios' })
      }
      if (dom === 25) {
        const mpBal = all<{ b: number }>(
          `SELECT a.initial_balance + COALESCE(SUM(CASE WHEN p.direction='in' THEN p.amount ELSE -p.amount END),0) AS b FROM accounts a LEFT JOIN payments p ON p.account_id = a.id WHERE a.id = ? GROUP BY a.id`,
          [mp],
        )[0]?.b
        if (mpBal > 400000) addTransfer({ date: d, from_account_id: mp, to_account_id: banco, amount: roundUpTo(mpBal - 200000, 1000) - 1000, description: 'Paso de Mercado Pago al banco' })
      }
      if (dom === 2 && dow !== 0) {
        const cajaBal = all<{ b: number }>(
          `SELECT a.initial_balance + COALESCE(SUM(CASE WHEN p.direction='in' THEN p.amount ELSE -p.amount END),0) AS b FROM accounts a LEFT JOIN payments p ON p.account_id = a.id WHERE a.id = ? GROUP BY a.id`,
          [caja],
        )[0]?.b
        if (cajaBal > 500000) addTransfer({ date: d, from_account_id: caja, to_account_id: banco, amount: roundUpTo(cajaBal - 250000, 1000) - 1000, description: 'Depósito de efectivo en el banco' })
      }

      if (dow === 0) continue // domingo cerrado

      // Club de vinos: primeros días hábiles del mes, 3 botellas por socio
      if (dom <= 6 && dow >= 1 && dow <= 5) {
        const members = clubMembers.filter((_, i) => i % 5 === dom % 5)
        for (const cid of members) {
          const chosen = [0, 1, 2].map(() => pick(products.filter((x) => x.stockSim > 0)))
          if (chosen.some((x) => !x) || new Set(chosen.map((x) => x.id)).size < 3) continue
          const items = chosen.map((p) => ({ product_id: p.id, description: null, qty: 1, unit_price: roundUpTo(p.price * f * 0.9, 100) }))
          createSale({
            date: d, client_id: cid, channel: 'club', price_list: 'minorista', payment_method: 'mercadopago', items,
            discount: 0, shipping: 0, fee: null, due_date: null, event_id: null, notes: 'Envío mensual del club (10 % off)', paid: true, account_id: mp,
          })
          chosen.forEach((p) => (p.stockSim -= 1))
          counts.sales++
        }
      }

      // Ventas del día
      const season = [0.75, 0.7, 0.85, 0.9, 0.95, 1.0, 1.05, 1.0, 1.0, 1.05, 1.15, 1.75][monthIdx]
      const weekday = [0, 0.8, 0.85, 0.9, 1.05, 1.35, 1.5][dow]
      const growth = 0.85 + 0.15 * (months.indexOf(m) / Math.max(1, months.length - 1))
      const nSales = Math.max(0, Math.round(rand(5, 9) * season * weekday * growth))
      for (let i = 0; i < nSales; i++) {
        const channel = weighted<SaleChannel>(['local', 'online', 'delivery', 'mayorista'], (c) => ({ local: 60, online: 22, delivery: 12, mayorista: 3 })[c as 'local'] ?? 1)
        const mayorista = channel === 'mayorista'
        const nItems = mayorista ? randInt(1, 3) : weighted([1, 2, 3], (n) => [62, 28, 10][n - 1])
        const used = new Set<number>()
        const items = [] as { product_id: number; description: null; qty: number; unit_price: number }[]
        for (let k = 0; k < nItems; k++) {
          const inStock = products.filter((x) => x.stockSim > 0)
          if (!inStock.length) break
          const p = weighted(inStock, (x) => x.popularity)
          if (used.has(p.id)) continue
          used.add(p.id)
          const wanted = mayorista ? pick([6, 6, 6, 12, 12]) : weighted([1, 2, 3, 6], (q) => [70, 20, 6, 4][[1, 2, 3, 6].indexOf(q)])
          const qty = Math.min(wanted, p.stockSim)
          const unit = roundUpTo((mayorista ? p.price * 0.82 : p.price) * f, 100)
          items.push({ product_id: p.id, description: null, qty, unit_price: unit })
          p.stockSim -= qty
        }
        if (!items.length) continue
        const bottlesN = items.reduce((s2, x) => s2 + x.qty, 0)
        const subtotal = items.reduce((s2, x) => s2 + x.qty * x.unit_price, 0)
        const method = mayorista
          ? 'transferencia'
          : weighted<PaymentMethod>(['efectivo', 'transferencia', 'debito', 'credito', 'mercadopago'], (x) => ({ efectivo: 24, transferencia: 22, debito: 18, credito: 14, mercadopago: 22 })[x as 'efectivo'] ?? 1)
        const discount = !mayorista && bottlesN >= 6 ? round2(subtotal * 0.1) : 0
        const shipping = channel === 'online' || channel === 'delivery' ? (r() < 0.7 ? roundUpTo(4500 * f, 100) : 0) : 0
        const biz = mayorista ? pick(bizClients.filter((c) => c.kind !== 'empresa')) : null
        const client = biz ? biz.id : r() < 0.35 ? pick(consumerIds) : null
        const due = mayorista ? addDays(d, pick([15, 30])) : null
        const paidNow = !mayorista || r() < 0.25
        const id = createSale({
          date: d, client_id: client, channel, price_list: mayorista ? 'mayorista' : 'minorista', payment_method: method, items,
          discount, shipping, fee: null, due_date: due, event_id: null, notes: null, paid: paidNow, account_id: methodAccount[method],
        })
        counts.sales++
        monthSales.set(m, (monthSales.get(m) ?? 0) + subtotal - discount + shipping)
        // Algunas ventas mayoristas recientes quedan sin cobrar (para ver "por cobrar" y "vencidas").
        if (!paidNow) pendingSales.push({ id, due: due!, account: banco, skip: d >= addMonths(ref, -2) && r() < 0.12 })
        // Envíos: costo del cadete/correo
        if (channel === 'online' || channel === 'delivery') {
          if (r() < 0.9) {
            createExpense({
              date: d, category: 'Envíos y logística', description: `Envío venta #${id}`, amount: roundUpTo(rand(3200, 5200) * f, 100), nature: 'variable',
              supplier_id: envios, due_date: null, event_id: null, notes: null, paid: true, account_id: mp,
            })
            counts.expenses++
          }
        }
      }

      // Regalos empresariales (diciembre)
      if (monthIdx === 11 && (dom === 10 || dom === 17)) {
        for (const emp of bizClients.filter((c) => c.kind === 'empresa')) {
          const p1 = products[1]
          const p2 = products[16]
          if (p1.stockSim < 24 || p2.stockSim < 12) continue
          const items = [
            { product_id: p1.id, description: null, qty: 24, unit_price: roundUpTo(p1.price * 0.85 * f, 100) },
            { product_id: p2.id, description: null, qty: 12, unit_price: roundUpTo(p2.price * 0.85 * f, 100) },
            { product_id: null, description: 'Caja de regalo con tarjeta personalizada', qty: 12, unit_price: roundUpTo(6500 * f, 100) },
          ]
          const id = createSale({
            date: d, client_id: emp.id, channel: 'mayorista', price_list: 'mayorista', payment_method: 'transferencia', items,
            discount: 0, shipping: roundUpTo(15000 * f, 100), fee: null, due_date: addDays(d, 30), event_id: null, notes: 'Regalos de fin de año', paid: false, account_id: banco,
          })
          p1.stockSim -= 24
          p2.stockSim -= 12
          pendingSales.push({ id, due: addDays(d, 30), account: banco, skip: false })
          counts.sales++
        }
      }

      // Eventos del día
      const ev = eventByDate.get(d)
      if (ev) {
        if (ev.ticket) {
          createSale({
            date: d, client_id: null, channel: 'eventos', price_list: 'minorista', payment_method: 'mercadopago',
            items: [{ product_id: null, description: 'Entrada al evento', qty: ev.attendees, unit_price: round2(ev.ticket * f) }],
            discount: 0, shipping: 0, fee: null, due_date: null, event_id: ev.id, notes: 'Entradas vendidas', paid: true, account_id: mp,
          })
          counts.sales++
        }
        const evSales = randInt(4, 10)
        for (let i = 0; i < evSales; i++) {
          const avail = products.filter((x) => x.stockSim > 0)
          if (!avail.length) break
          const p = weighted(avail, (x) => x.popularity)
          const qty = Math.min(pick([1, 2, 2, 3, 6]), p.stockSim)
          createSale({
            date: d, client_id: r() < 0.5 ? pick(consumerIds) : null, channel: 'eventos', price_list: 'minorista', payment_method: pick(['efectivo', 'mercadopago', 'debito'] as PaymentMethod[]),
            items: [{ product_id: p.id, description: null, qty, unit_price: roundUpTo(p.price * f * 0.9, 100) }],
            discount: 0, shipping: 0, fee: null, due_date: null, event_id: ev.id, notes: 'Venta durante el evento', paid: true, account_id: null,
          })
          p.stockSim -= qty
          counts.sales++
        }
        // Botellas abiertas para degustar
        for (const p of [products[0], products[1], products[9], products[16]].slice(0, randInt(2, 4))) {
          const q = Math.min(randInt(2, 4), p.stockSim)
          if (q <= 0) continue
          addMovement({ product_id: p.id, date: d, kind: 'degustacion', qty: -q, ref_type: 'event', ref_id: ev.id, notes: `Degustación: ${ev.name}` })
          p.stockSim -= q
        }
        for (const [cat, desc, amt] of [
          ['Eventos y degustaciones', 'Copas, hielo y servilletas', 38000],
          ['Eventos y degustaciones', 'Quesos y picada', 85000],
          ['Marketing y redes', 'Difusión del evento en redes', 25000],
        ] as const) {
          createExpense({
            date: d, category: cat, description: desc, amount: roundUpTo(amt * f * rand(0.8, 1.3), 100), nature: 'variable',
            supplier_id: null, due_date: null, event_id: ev.id, notes: null, paid: true, account_id: caja,
          })
          counts.expenses++
        }
      }

      // Compras: lunes y jueves, reponer lo que esté bajo
      if (dow === 1 || dow === 4) {
        const byWinery = new Map<number, typeof products>()
        for (const p of products) {
          // En los últimos días no se repusieron algunos vinos (así el ejemplo muestra alertas de stock bajo).
          if (d >= addDays(ref, -12) && p.popularity <= 4) continue
          if (p.stockSim <= p.min * 1.4) {
            const list = byWinery.get(p.winery) ?? []
            list.push(p)
            byWinery.set(p.winery, list)
          }
        }
        for (const [w, list] of byWinery) {
          const items = list.map((p) => {
            const target = Math.max(p.min * 3, Math.round(p.popularity * (monthIdx === 10 || monthIdx === 11 ? 10 : 6)))
            const qty = Math.max(6, Math.ceil((target - p.stockSim) / 6) * 6)
            p.stockSim += qty
            return { product_id: p.id, qty, unit_cost: round2(p.cost * f * rand(0.97, 1.03)) }
          })
          const terms = r() < 0.4
          const shipping = roundUpTo(items.reduce((s2, x) => s2 + x.qty, 0) * 650 * f, 100)
          const id = createPurchase({
            date: d, supplier_id: wineryIds[w], invoice_number: `A-0003-${String(randInt(1000, 99999)).padStart(8, '0')}`, items, shipping,
            due_date: terms ? addDays(d, 30) : null, notes: terms ? 'Pago a 30 días' : null, paid: !terms, account_id: banco,
          })
          counts.purchases++
          if (terms) pendingPurchases.push({ id, due: addDays(d, 30), account: banco })
        }
      }

      // Packaging y marketing (variables), mantenimiento de cuenta, impuestos
      if (dom === 6) {
        createExpense({
          date: d, category: 'Packaging (cajas, bolsas, etiquetas)', description: 'Cajas x6 y bolsas de papel', amount: roundUpTo(rand(90000, 160000) * f, 100), nature: 'variable',
          supplier_id: cartonera, due_date: null, event_id: null, notes: null, paid: true, account_id: banco,
        })
        counts.expenses++
      }
      if (dom === 9) {
        createExpense({
          date: d, category: 'Marketing y redes', description: 'Publicidad en Instagram', amount: roundUpTo(rand(80000, 140000) * f, 100), nature: 'variable',
          supplier_id: null, due_date: null, event_id: null, notes: null, paid: true, account_id: mp,
        })
        counts.expenses++
      }
      if (dom === 18) {
        const prevMonth = monthKey(addMonths(startOfMonth(d), -1))
        const base = monthSales.get(prevMonth) ?? 7000000 * f
        createExpense({
          date: d, category: 'Impuestos y tasas', description: `Ingresos Brutos ${prevMonth.split('-').reverse().join('/')}`, amount: round2(base * 0.035), nature: 'variable',
          supplier_id: null, due_date: d, event_id: null, notes: 'Calculado sobre las ventas del mes anterior', paid: true, account_id: banco,
        })
        createExpense({
          date: d, category: 'Bancos y comisiones', description: 'Mantenimiento de cuenta y transferencias', amount: roundUpTo(26000 * f, 100), nature: 'variable',
          supplier_id: null, due_date: null, event_id: null, notes: null, paid: true, account_id: banco,
        })
        counts.expenses += 2
      }

      // Roturas ocasionales
      if (r() < 0.05) {
        const p = weighted(products.filter((x) => x.stockSim > 0), (x) => x.popularity)
        if (p) addMovement({ product_id: p.id, date: d, kind: 'rotura', qty: -1, notes: 'Se cayó una botella en el depósito' })
        if (p) p.stockSim -= 1
      }

      // Cobros y pagos que vencen hoy
      for (const ps of pendingSales.filter((x) => x.due === d && !x.skip)) {
        const bal = round2(all<{ t: number }>('SELECT total AS t FROM sales WHERE id = ?', [ps.id])[0].t - paidFor('sale', ps.id))
        if (bal > 0) addSettlement('sale', ps.id, { date: d, amount: bal, account_id: ps.account, description: 'Cobro por transferencia' })
      }
      for (const pp of pendingPurchases.filter((x) => x.due === d)) {
        const bal = round2(all<{ t: number }>('SELECT total AS t FROM purchases WHERE id = ?', [pp.id])[0].t - paidFor('purchase', pp.id))
        if (bal > 0) addSettlement('purchase', pp.id, { date: d, amount: bal, account_id: pp.account, description: 'Pago a proveedor' })
      }
    }

    // Precios actuales (los de hoy) y metas del año
    for (const p of products) {
      run('UPDATE products SET price_retail = ?, price_wholesale = ? WHERE id = ?', [p.price, roundUpTo(p.price * 0.82, 100), p.id])
    }
    const year = ref.slice(0, 4)
    for (let mm = 1; mm <= 12; mm++) {
      const month = `${year}-${String(mm).padStart(2, '0')}`
      const lastYear = monthSales.get(`${Number(year) - 1}-${String(mm).padStart(2, '0')}`)
      const base = lastYear ? lastYear * 1.35 : (monthSales.get(month) ?? 9000000) * 1.05
      run('INSERT INTO goals (month, sales_target, bottles_target, expense_budget, notes) VALUES (?, ?, ?, ?, ?)', [
        month,
        roundUpTo(base, 100000),
        Math.round(base / 16000 / 10) * 10,
        roundUpTo(base * 0.33, 50000),
        'Meta de ejemplo',
      ])
    }
    void endOfMonth
  })
  return counts
}
