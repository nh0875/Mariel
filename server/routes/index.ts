// Todas las rutas de la API cuelgan de /api. Cada módulo define sus rutas completas
// (ej: el router de vinos define '/products' y '/stock/...').
import { Router } from 'express'
import products from './products'
import sales from './sales'
import purchases from './purchases'
import suppliers from './suppliers'
import expenses from './expenses'
import accounts from './accounts'
import clients from './clients'
import dashboard from './dashboard'
import goals from './goals'
import reports from './reports'
import calculator from './calculator'
import events from './events'
import settings from './settings'

const api = Router()

api.get('/health', (_req, res) => {
  res.json({ ok: true, app: 'VINOH! Finanzas' })
})

for (const r of [products, sales, purchases, suppliers, expenses, accounts, clients, dashboard, goals, reports, calculator, events, settings]) {
  api.use(r)
}

export default api
