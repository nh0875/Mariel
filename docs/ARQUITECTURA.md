# VINOH! Finanzas — Arquitectura y contratos

Documento técnico para quien mantenga el sistema. (La guía para usuarios está en `README.md` y dentro del programa, en **Ayuda**.)

## 1. Qué es y por qué está hecho así

Sistema de finanzas, costos, stock y ventas para una empresa de vinos. **Corre solo en la computadora** (localhost, `127.0.0.1:3030`): nadie de afuera puede entrar y no hay que pagar servidores.

Decisiones y su porqué:

| Decisión | Por qué |
|---|---|
| **Node.js + SQLite (`node:sqlite`)** | Un solo archivo de datos (`data/vinoh.db`), nada que compilar al instalar (viene con Node ≥ 22.13), funciona igual en Windows, Mac y Linux. |
| **Express (API) + React/Vite (pantallas)** | Separación clara: la API calcula y valida, la interfaz muestra. |
| **Lanzador de doble clic** (`INICIAR-VINOH-*.bat/.command`) | Los usuarios no son de sistemas: un clic instala lo necesario la primera vez, compila la interfaz si cambió y abre el navegador. |
| **Copias de seguridad automáticas diarias** (`data/backups/`, últimas 30) | Un archivo local se puede borrar o romper; con esto siempre hay vuelta atrás. |
| **Todo en pesos, montos finales (con impuestos)** | Es lo que la gente ve en el ticket/factura. El dólar es solo referencia (Configuración). |
| **Criterio devengado para el resultado, percibido para la caja** | Es lo correcto contablemente y se explica en Ayuda ("Resultado ≠ Caja"). |
| **Costo promedio ponderado con recálculo histórico** | Método estándar para comercios (y aceptado por ARCA). Si se carga algo con fecha vieja o se edita, se recalcula todo el vino en orden y los números cierran. |
| **Flete de compras prorrateado en el costo** | El costo de cada botella es el real ("puesto en depósito"). |

## 2. Estructura

```
client/            Interfaz (React + Vite + Tailwind v4)
  src/components/ui/      Kit de componentes (usar SIEMPRE estos)
  src/components/charts/  Gráficos (Recharts con estilo de la marca)
  src/lib/                api.ts, queries.ts, format.ts, glossary.ts, period.tsx, nav.ts, hooks.ts, eventPreset.ts
  src/pages/<modulo>/     Una carpeta por pantalla
  src/layout/             Menú lateral, barra superior
server/            API (Express 5 + node:sqlite)
  db.ts                   Conexión, migraciones, helpers all/get/run/scalar/tx
  lib/                    http.ts (errores/validación), excel.ts (exportar), backup.ts
  services/               Lógica de negocio central (stock, pagos, ventas, compras, gastos, finanzas)
  routes/<modulo>.ts      Rutas de cada módulo (cada router define sus paths completos bajo /api)
  seed/demo.ts            Datos de ejemplo
  tests/                  Tests (vitest)
shared/            Tipos (también las respuestas de Eventos), constantes, validaciones (zod), fechas y fórmulas (calc.ts, pricing.ts)
scripts/iniciar.mjs Arranque para usuarios
data/              (no se versiona) base de datos y backups
```

Comandos: `npm run dev` (API + Vite con recarga), `npm run build`, `npm start`, `npm test`, `npm run typecheck`, `npm run demo`.

## 3. Modelo contable (el corazón)

- **Stock** = suma de `stock_movements`. Tipos: `inicial`, `compra` (entran con su costo), `venta`, `rotura`, `degustacion`, `regalo`, `consumo`, `ajuste` (±), `devolucion` (+, al promedio), `revaluo` (fija costo, qty 0). Nunca escribir `products.stock` o `products.unit_cost` a mano: usar `services/stock.ts` (`addMovement`, `removeMovementsByRef`, `recalcProduct`).
- **Costo de lo vendido (CMV)** = Σ `sale_items.qty × sale_items.unit_cost`; `unit_cost` lo mantiene el recálculo de stock.
- **Mermas** = salidas no-venta (`SHRINKAGE_KINDS`) valorizadas al costo.
- **Caja** = tabla `payments` (in/out por cuenta). El saldo de una cuenta (`accountBalances(asOf = hoy)`) suma lo movido **hasta hoy**: un pago cargado con fecha futura (ej. un gasto fijo del día 20 marcado como pagado) sale de la caja ese día. Cobros de ventas (`ref_type='sale'`), pagos de compras/gastos, comisiones automáticas (`sale_fee`, proporcionales a cada cobro), transferencias (`transfer`, dos patas con `transfer_id`) y movimientos manuales (aporte, retiro, préstamos, ajuste…).
- **Estado de cobro/pago** se deriva: `paid = Σ payments`, `balance = total − paid`, `status ∈ pagado|parcial|pendiente`, `overdue` si hay `due_date` vencida.
- **Resultado** (`services/finance.ts → periodSummary`): `Ventas − CMV − Comisiones − Mermas − Gastos`. Comprar vino NO es gasto.
- Servicios listos para usar: `createSale/updateSale/deleteSale/listSales/getSaleDetail`, `createPurchase/...`, `createExpense/...`, `generateRecurringForMonth`, `addSettlement`, `deletePayment`, `addTransfer`, `accountBalances`, `periodSummary`, `monthlySeries`, `stockValue`, `receivables`, `payables`, `salesByProduct`, `salesByChannel`, `expensesByCategory`, `lowStock`.

## 4. Convenciones de la API

- Todo bajo `/api`. JSON. Fechas `YYYY-MM-DD`. Plata como número en pesos.
- Validar el body con los esquemas de `shared/schemas.ts` usando `validate(schema, req.body)` (tira 400 con mensaje en castellano).
- Errores: `throw new HttpError(status, 'mensaje para el usuario')` / `notFound('el vino')`. El manejador global responde `{ error }`.
- Filtros de período: `parsePeriod(req)` → `{from, to}` (default: mes actual). Query helpers `qs(req,'x')`, `qn(req,'x')`.
- Crear (`POST`) devuelve el registro creado (incluye `id`). Editar (`PUT`) devuelve el registro actualizado. Borrar (`DELETE`) devuelve `{ ok: true }`.
- Si algo tiene movimientos y no se puede borrar → 409 con sugerencia de desactivar.
- Excel: `sendWorkbook(res, excelFilename('ventas'), [{ name, title, subtitle: periodSubtitle(from,to), columns, rows, notes }])`. Columnas tipadas (`money`, `int`, `percent`, `date`, `text`); fila de totales automática; agregar `notes` explicando cómo leer la planilla.
- Subidas de archivos (Excel/backup): el cliente manda el binario crudo (`api.upload`); en la ruta usar `express.raw({ type: () => true, limit: '50mb' })`.
- Archivos de ruta: `server/routes/<modulo>.ts` exporta `default` un `Router()`; ya están registrados en `routes/index.ts`.

### Endpoints por módulo

Reglas comunes: los listados de ventas, compras y gastos aceptan `from`/`to` **opcionales** (sin ellos traen todas las fechas); los resúmenes (`/summary`), Inicio y los Excel usan `parsePeriod` (sin fechas = mes actual). Los cobros/pagos parciales usan `settlementInput` y devuelven el detalle actualizado. Fuera de módulo: `GET /health` → `{ ok, app }`.

**Vinos y stock** (`routes/products.ts`)
- `GET /products?active=1|0` → `ProductWithStats[]` = `Product` + `sold_90d`, `days_of_stock` (null si no vendió), `margin_retail`, `margin_wholesale` (0..1), `stock_value`.
- `GET /products/:id` → `{ product, movements (últimos 300, con saldo), stats, monthly (12 meses) }`. `stats`: `sold_total, revenue_total, cost_total, profit_total, sold_90d, days_of_stock, last_sale_date, last_purchase_date, last_purchase_cost, last_purchase_supplier, shrinkage_bottles, shrinkage_cost, reorder_suggestion, first_movement_date`.
- `POST /products` (`productInput`; crea el movimiento `inicial` con `initial_stock` y `unit_cost`) · `PUT /products/:id` (mezcla con lo guardado) · `DELETE /products/:id` (409 si tiene ventas/compras o movimientos: sugerir desactivar).
- `POST /products/:id/adjust` (`stockAdjustInput`; con `kind:'ajuste'` acepta `counted` = botellas contadas ese día y calcula la diferencia contra el stock **a esa fecha**) · `GET /products/:id/stock-at?date` → `{ date, stock }` · `POST /products/:id/cost` (`costChangeInput`). Ajustes y cambios de costo con fecha anterior al primer movimiento del vino → 400. Devuelven el `Product`.
- `GET /stock/movements?from&to&product_id&kind` → `MovementRow[]` · `DELETE /stock/movements/:id` (solo manuales; los de ventas/compras se cambian desde su documento).
- `POST /products/bulk-price[?preview=1]` (`bulkPriceInput`) → `{ updated, matched, preview, examples[] }` (las bajas redondean hacia abajo).
- Excel: `GET /products/export?active=1` · `GET /products/price-list?list=minorista|mayorista` · `GET /products/import-template[?con_vinos=1]` · `POST /products/import` (binario) → `{ created, updated, errors[{row,message}], notes, total }` · `GET /stock/export?from&to&product_id` (con `product_id` y sin fechas: toda su historia).

**Ventas** (`routes/sales.ts`)
- `GET /sales?from&to&channel&client_id&event_id&product_id&status` (`status`: `pagado|parcial|pendiente|por_cobrar|vencida`) → `SaleWithStatus[]` + `items_preview[{name, qty, is_wine}]`.
- `GET /sales/summary?from&to` → `{ from, to, count, total, bottles, cost, fees, profit, margin, avg_ticket, pending, pending_count, overdue, overdue_count, receivables, first_sale_date, by_channel[], by_payment_method[], by_day[] }`.
- `GET /sales/:id` → `SaleDetail` · `POST /sales` (`saleInput`) · `PUT /sales/:id` (si el total y la cuenta no cambian, conserva los cobros y sus fechas) · `DELETE /sales/:id`.
- `POST /sales/:id/payments` → `SaleDetail` · `GET /sales/:id/receipt[?print=1]` (comprobante HTML imprimible, no es factura) · `GET /sales/export` (mismos filtros).

**Compras + Proveedores** (`routes/purchases.ts`, `routes/suppliers.ts`)
- `GET /purchases?from&to&supplier_id&product_id&status` (`status`: `pagado|parcial|pendiente|por_pagar|vencida`) → `PurchaseWithStatus[]` + `items_preview[{name, qty}]`.
- `GET /purchases/summary?from&to` → `{ count, total, subtotal, shipping, bottles, avg_cost_per_bottle, avg_invoice_cost, shipping_share, pending, pending_count, payables{total,count,overdue,overdue_count,next_due}, by_supplier[], … }`.
- `GET /purchases/last-prices?supplier_id` → `[{ product_id, unit_cost, date, supplier_id, supplier_name, same_supplier }]` (último precio de factura por vino, priorizando ese proveedor).
- `GET/PUT/DELETE /purchases/:id` · `POST /purchases` · `POST /purchases/:id/payments` · `DELETE /purchases/:id/payments/:paymentId` · `GET /purchases/export` (con `status=por_pagar|vencida` y sin fechas: lo que se debe hoy, de cualquier fecha). Al editar una compra pagada se conservan las fechas y cuentas de sus pagos.
- `GET /suppliers` → `Supplier` + `balance, overdue, purchases_balance, expenses_balance, total_bought, bottles, purchases_count, last_purchase, expenses_total, expenses_count`.
- `GET /suppliers/:id` → `{ supplier, purchases, expenses, stats{…, top_wines}, wines[] (con price_change), monthly (12 meses) }` · `POST/PUT/DELETE /suppliers[/:id]` · `GET /suppliers/export`.

**Gastos** (`routes/expenses.ts`)
- `GET /expenses?from&to&category&nature&status&event_id&supplier_id` (`status`: `pagado|parcial|pendiente|por_pagar|vencido`) → `ExpenseWithStatus[]` · `GET /expenses/:id` → detalle con pagos.
- `GET /expenses/summary?from&to` → `{ total, fixed, variable, count, pending, overdue, payables_total, sales, vs_sales, by_category[{…, nature: fijo|variable|mixto, fixed, variable}], gone_categories, previous, comparison{mode, comparable, current, previous}, monthly, first_expense_date }`.
- `POST /expenses` (`expenseInput` + opcionales `repeat_monthly`, `repeat_auto_paid`: crea también la plantilla de gasto fijo) · `PUT/DELETE /expenses/:id` · `POST /expenses/:id/payments` · `DELETE /expenses/:id/payments/:paymentId` · `GET /expenses/export`.
- `GET/POST/PUT/DELETE /recurring-expenses[/:id]` · `GET /recurring-expenses/status?month` → `{ month, label, templates, generated, missing, missing_amount, monthly_total, items[] }` · `POST /recurring-expenses/generate { month }` → `{ month, label, created, skipped, status }` (no duplica).

**Caja + Clientes** (`routes/accounts.ts`, `routes/clients.ts`)
- `GET /accounts[?as_of]` → `AccountWithBalance` + `month_in, month_out, movements_count, last_movement`. Los saldos cuentan los movimientos **hasta hoy** (o `as_of`): un pago cargado con fecha futura todavía no descuenta. `POST/PUT/DELETE /accounts[/:id]` (siempre queda al menos una activa) · `POST /accounts/:id/reconcile { date, counted }` (arqueo: registra el ajuste por la diferencia).
- `GET /movements?from&to&account_id&direction&ref_type` (`ref_type` admite lista separada por comas y `manual`) → `{ from, to, account_id, rows[], summary{total_in,total_out,net,count,opening_balance,closing_balance,transfers} }` · `POST /movements` (`manualCashInput`) · `PUT /movements/:id` (solo manuales) · `POST /transfers` · `DELETE /payments/:id` (genérico) · `GET /movements/export`.
- `GET /pending` → `{ receivables[], payables[], totals, projection }` (proyección a 30 días) · `GET /pending/export` · `GET /cashflow?from&to` (default: últimos 12 meses) → `{ months[], by_kind[], totals, projection }` · `GET /cashflow/export`.
- `GET /clients` → `Client` + `total_bought, bottles, purchases_count, first_purchase, last_purchase, balance, overdue, pending_count, year_total, profit` · `GET /clients/:id` → `{ client, sales, stats{…, favorite_wines}, monthly }` · `POST/PUT/DELETE` · `GET /clients/export`.

**Inicio + Metas** (`routes/dashboard.ts`, `routes/goals.ts`)
- `GET /dashboard?from&to` → `{ period, today, period_label, period_phrase, summary, previous, same_days_previous, comparison{mode, label, detail, current, previous, partial, data_since, after_today}, series (12 meses), cash{total, accounts, scheduled{out,in}}, stock, receivables, payables, low_stock, top_products, by_channel, goal_month, goal, alerts[], insights[], setup }`. `cash.scheduled` = movimientos ya cargados con fecha posterior a hoy (todavía no están en el saldo). `GET /dashboard/export`.
- `GET /goals?year` → 12 × `GoalMonth` (meta + `actual`, `progress`, `status: past|current|future`…) · `PUT /goals/:month` (`goalInput` sin `month`) · `DELETE /goals/:month` · `GET /goals/suggest?month` → `{ break_even_sales, last_year_plus_inflation, avg_last_3_months, suggestion, basis, explanation, steps[], … }` · `GET /goals/export?year`.

**Reportes** (`routes/reports.ts`)
- `GET /reports/pnl|channels|clients|expenses|inflation?from&to` (default: últimos 12 meses) → `{ period: { from, to, requested, trimmed }, … }`: el período se recorta a los meses con datos (sin meses vacíos al principio ni futuros). `GET /reports/products` devuelve un **array** (`ProductReportRow[]`, análisis ABC). Cada uno tiene `/export`; `GET /reports/full/export` = todas las hojas + índice.
- `GET /inflation` · `PUT /inflation/:month { rate }` · `DELETE /inflation/:month`.

**Calculadora** (`routes/calculator.ts`, fórmulas en `shared/pricing.ts`)
- `GET /calculator/context` → `CalculatorContext` (`has_data, months_used, avg_sales, avg_bottles, avg_price_per_bottle, avg_cost_per_bottle, avg_cogs, avg_fixed_expenses, avg_variable_expenses, avg_fees, avg_shrinkage, avg_fee_pct, variable_pct_of_sales, gross_margin, avg_net_result, fixed_by_category, pricing, usd_rate, usd_rate_date, payment_methods, units_per_box, products`). Promedios de los últimos meses completos.
- `GET /calculator/prices?target_margin_pct&iibb_pct&fee_pct&round_to&wholesale_discount_pct` → `PriceReviewRow[]` (revisión de precios de los vinos activos) · `GET /calculator/prices/export`.
- Ojo: el margen de la Calculadora es **después de IIBB y comisión** (`suggestPrice`: precio = costo ÷ (1 − margen − IIBB − comisión)); el «Margen objetivo» de Configuración, Vinos y Reportes es **margen bruto**. Las dos pantallas lo explican.

**Eventos** (`routes/events.ts`; tipos `EventSummary`, `EventWithSummary`, `EventSale`, `OpenedBottle`, `EventDetail` en `shared/types.ts`; `openBottlesInput` en `shared/schemas.ts`)
- `GET /events?from&to` (opcionales) → `EventWithSummary[]` · `GET /events/:id` → `EventDetail` (`{ event, summary, sales, expenses, opened, after, budget_used }`) · `POST/PUT/DELETE /events[/:id]` (al cambiar la fecha se mueven las botellas abiertas de ese día).
- `POST /events/:id/open-bottles` (`openBottlesInput`) → `EventDetail` + `created` · `DELETE /events/:id/open-bottles/:movementId` · `GET /events/export` · `GET /events/:id/export`.

**Configuración** (`routes/settings.ts`)
- `GET /settings` · `PUT /settings` (`settingsInput`, parcial: mezcla lo que viene; `payment_methods` se mezcla por `key` y rechaza cuentas inexistentes o desactivadas; acepta `category_renames: [{from, to}]`, que renombra los gastos fijos, no los gastos ya cargados).
- `GET /settings/category-usage` → `{ categories[{name, nature, expenses, amount, recurring, last_date}], others[] }` · `GET /system` → `{ version, node, platform, in_memory, db_path, data_dir, backup_dir, db_size, counts[], last_backup, backups_count }`.
- `GET /backups` → `{ available, message, data_dir, db_path, backup_dir, keep, backups[{file, size, created_at, kind, label}] }` · `POST /backups` · `GET /backups/:file/download` · `POST /backups/:file/restore` · `POST /backups/restore-upload` (binario). Antes de restaurar, cargar el ejemplo o borrar todo se hace una copia automática.
- `GET /export/all` (todo en un Excel) · `POST /demo/load` → `{ ok, sales, purchases, expenses }` · `POST /data/reset { restart_onboarding? }` (borra los datos, mantiene la configuración).

## 5. Convenciones de la interfaz

- **Idioma**: castellano rioplatense con voseo ("Cargá", "Mirá", "¿Ya lo cobraste?"). Tono descontracturado pero claro. Nombrar las cosas como las llama la gente del negocio, nunca como se llaman en la base.
- **Siempre** usar el kit `@/components/ui` y `@/components/charts`. Nada de estilos sueltos que repitan lo que ya hay.
- Cada pantalla: `PageHeader` (título + descripción + acciones) → `HelpBox` ("¿Para qué sirve esta pantalla?", con ejemplos y el porqué) → contenido.
- Cada número importante lleva su `InfoTip term="..."` (glosario en `lib/glossary.ts`) o un texto explicativo.
- Una sola acción `variant="primary"` por pantalla. Borrar siempre con `useConfirm()` (`danger: true`).
- Datos: `useApi<T>(path, params)` para leer; `useApiMutation(fn, { success: 'Venta guardada' })` para escribir (refresca todo y avisa con un toast).
- Período: `usePeriod()` (compartido entre pantallas) + `<PeriodPicker/>`.
- Plata: `money()`, `moneyCompact()`, `<Money/>`; porcentajes `pct()`; fechas `date()`, `dateShort()`.
- Formularios en `Modal`. Campos: `Field` + `TextInput` / `MoneyInput` / `IntInput` / `DateInput` / `Select` / `ChoiceCards` / `ProductSelect` / `ClientSelect` / `SupplierSelect` / `AccountSelect` / `EventSelect`. `Field` une solo su etiqueta con el campo del kit que tiene adentro (no hace falta `htmlFor`/`id`; si pasás `htmlFor`, manda el tuyo). `MoneyInput` muestra los centavos completos ("18.586,20").
- Tarjetas de números: `StatTile` (`term` del glosario o `info={{ title, text }}` propio). Pestañas: `Tabs` (si no entran en una línea, bajan a la siguiente).
- Listas: `DataTable` (búsqueda, orden, paginado, totales) con `EmptyState` cuando no hay nada (y botón para cargar el primero).
- Exportar: `<ExportButton path="/sales/export" params={{ from, to }} />`.
- Botones rápidos de arriba: abren `/ventas?nuevo=1`, `/gastos?nuevo=1`, `/compras?nuevo=1`. Cada pantalla usa `useNewParam()` para abrir su formulario. Los parámetros "de una vez" (`nuevo`, `evento`, `cliente`, `importar`…) se borran de la URL apenas se usan; `tab` y `ver` quedan (se pueden compartir/recargar).
- Cobros/pagos: usar `<SettlementModal kind="sale|purchase|expense" … />` de `@/components/forms/SettlementModal` (postea a `/{sales|purchases|expenses}/:id/payments`).
- Colores por grupo del menú (`lib/nav.ts`): naranja = Cómo venimos, celeste = Entra plata, coral = Sale plata, mostaza = Los vinos, marrón = Herramientas.
- Colores de gráficos fijos por concepto (`CHART_COLORS`): ventas azul, gastos coral, costo mostaza, ganancia verde azulado. Los gráficos llevan tabla alternativa (`ChartCard table={…}`).

**Links profundos de cada pantalla** (usalos en vez de inventar otros):

| Pantalla | Parámetros |
|---|---|
| `/` Inicio | — (usa el período compartido) |
| `/caja` | `?tab=movimientos\|pendientes\|flujo` · `?cuenta=ID` (movimientos de esa cuenta) · `?nuevo=1` (nuevo movimiento) |
| `/reportes` | `?tab=resultados\|vinos\|canales\|clientes\|gastos\|inflacion` |
| `/metas` | `?mes=AAAA-MM` (abre la meta de ese mes) |
| `/ventas` | `?nuevo=1` · `&cliente=ID` (cliente elegido) · `&evento=ID` (evento + canal Eventos; si el evento ya pasó, la fecha arranca en la del evento) · `&entrada=1` (con `evento`: renglón «Entrada» = precio de la entrada × personas) · `?ver=ID` (detalle) |
| `/clientes` | `?nuevo=1` (fichas: `/clientes/:id`, `/eventos/:id`, `/proveedores/:id`, `/vinos/:id`, sin parámetros) |
| `/eventos` | `?nuevo=1` |
| `/compras` | `?nuevo=1` · `?proveedor=ID` · `?vino=ID` (abre «Nueva compra» con ese proveedor/vino y su último precio) · `?ver=ID` |
| `/gastos` | `?nuevo=1` · `&evento=ID` (igual que en ventas: fecha del evento si ya pasó) · `?ver=ID` · `?tab=gastos\|fijos\|categorias` |
| `/proveedores` | `?nuevo=1` |
| `/vinos` | `?nuevo=1` · `?importar=1` (abre «Importar desde Excel») |
| `/calculadora` | `?tab=precio\|ganancia\|equilibrio\|simulador\|cajas` · `?vino=ID` («¿A cuánto lo vendo?» con ese vino) |
| `/ayuda` | `#empeza-por-aca`, `#como-hago`, `#como-calcula`, `#diccionario`, `#tus-datos`, `#<clave del glosario>` (ej. `#mermas`), `#<pregunta frecuente>` |
| `/configuracion` | `#negocio`, `#cuentas`, `#medios-de-pago`, `#categorias`, `#precios`, `#stock`, `#dolar`, `#backups`, `#datos` |
| `/bienvenida` | Asistente inicial (se muestra solo mientras `onboarding.completed` es false) |

## 6. Calidad

- `npm run typecheck` y `npm test` tienen que pasar.
- Tests de lógica en `server/tests/*.test.ts`; para probar rutas usar `startTestServer()` de `server/tests/helpers.ts` (base en memoria).
