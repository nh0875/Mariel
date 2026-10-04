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
  src/lib/                api.ts, queries.ts, format.ts, glossary.ts, period.tsx, nav.ts, hooks.ts
  src/pages/<modulo>/     Una carpeta por pantalla
  src/layout/             Menú lateral, barra superior
server/            API (Express 5 + node:sqlite)
  db.ts                   Conexión, migraciones, helpers all/get/run/scalar/tx
  lib/                    http.ts (errores/validación), excel.ts (exportar), backup.ts
  services/               Lógica de negocio central (stock, pagos, ventas, compras, gastos, finanzas)
  routes/<modulo>.ts      Rutas de cada módulo (cada router define sus paths completos bajo /api)
  seed/demo.ts            Datos de ejemplo
  tests/                  Tests (vitest)
shared/            Tipos, constantes, validaciones (zod), fechas y fórmulas compartidas
scripts/iniciar.mjs Arranque para usuarios
data/              (no se versiona) base de datos y backups
```

Comandos: `npm run dev` (API + Vite con recarga), `npm run build`, `npm start`, `npm test`, `npm run typecheck`, `npm run demo`.

## 3. Modelo contable (el corazón)

- **Stock** = suma de `stock_movements`. Tipos: `inicial`, `compra` (entran con su costo), `venta`, `rotura`, `degustacion`, `regalo`, `consumo`, `ajuste` (±), `devolucion` (+, al promedio), `revaluo` (fija costo, qty 0). Nunca escribir `products.stock` o `products.unit_cost` a mano: usar `services/stock.ts` (`addMovement`, `removeMovementsByRef`, `recalcProduct`).
- **Costo de lo vendido (CMV)** = Σ `sale_items.qty × sale_items.unit_cost`; `unit_cost` lo mantiene el recálculo de stock.
- **Mermas** = salidas no-venta (`SHRINKAGE_KINDS`) valorizadas al costo.
- **Caja** = tabla `payments` (in/out por cuenta). Cobros de ventas (`ref_type='sale'`), pagos de compras/gastos, comisiones automáticas (`sale_fee`, proporcionales a cada cobro), transferencias (`transfer`, dos patas con `transfer_id`) y movimientos manuales (aporte, retiro, préstamos, ajuste…).
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

**Vinos y stock** (`routes/products.ts`)
- `GET /products?active=1` → `Product[]` + extras: `sold_90d`, `days_of_stock` (null si no vendió), `margin_retail` (0..1), `stock_value`.
- `GET /products/:id` → `{ product, movements, stats, monthly }`.
- `POST /products` (`productInput`, crea movimiento `inicial` con `initial_stock` y `unit_cost`) · `PUT /products/:id` · `DELETE /products/:id`.
- `POST /products/:id/adjust` (`stockAdjustInput`) · `POST /products/:id/cost` (`costChangeInput`) · `DELETE /stock/movements/:id` (solo manuales).
- `GET /stock/movements?from&to&product_id&kind` · `POST /products/bulk-price` (`bulkPriceInput`).
- `GET /products/export` · `GET /products/price-list?list=minorista|mayorista` · `GET /products/import-template` · `POST /products/import` · `GET /stock/export`.

**Ventas** (`routes/sales.ts`)
- `GET /sales?from&to&channel&client_id&status&event_id&product_id` → `SaleWithStatus[]` · `GET /sales/summary?from&to`.
- `GET /sales/:id` → `SaleDetail` · `POST /sales` (`saleInput`) · `PUT /sales/:id` · `DELETE /sales/:id`.
- `POST /sales/:id/payments` (`settlementInput`) → `SaleDetail` · `GET /sales/export`.

**Compras + Proveedores** (`routes/purchases.ts`, `routes/suppliers.ts`)
- `GET /purchases?from&to&supplier_id&status&product_id` · `GET/PUT/DELETE /purchases/:id` · `POST /purchases` · `POST /purchases/:id/payments` · `GET /purchases/export`.
- `GET /suppliers` → `(Supplier & { balance, total_bought })[]` · `GET /suppliers/:id` · `POST/PUT/DELETE` · `GET /suppliers/export`.

**Gastos** (`routes/expenses.ts`)
- `GET /expenses?from&to&category&nature&status&event_id&supplier_id` · `GET /expenses/summary?from&to` · `POST/PUT/DELETE` · `POST /expenses/:id/payments` · `GET /expenses/export`.
- `GET/POST/PUT/DELETE /recurring-expenses` · `POST /recurring-expenses/generate` `{ month }` → `{ created, skipped }`.

**Caja + Clientes** (`routes/accounts.ts`, `routes/clients.ts`)
- `GET /accounts` → `AccountWithBalance[]` · `POST/PUT/DELETE /accounts/:id`.
- `GET /movements?from&to&account_id&direction&ref_type` · `POST /movements` (`manualCashInput`) · `DELETE /payments/:id` (genérico, usa `deletePayment`) · `POST /transfers`.
- `GET /pending` → `{ receivables, payables, totals }` · `GET /cashflow?from&to` · `GET /movements/export` · `GET /pending/export`.
- `GET /clients` → `(Client & { balance, total_bought, last_purchase })[]` · `GET /clients/:id` · `POST/PUT/DELETE` · `GET /clients/export`.

**Inicio + Metas** (`routes/dashboard.ts`, `routes/goals.ts`)
- `GET /dashboard?from&to` → resumen, período anterior, serie 12 meses, caja, stock, deudas, alertas, top vinos, canales, meta del mes, frases de "insights".
- `GET /goals?year` · `PUT /goals/:month` · `DELETE /goals/:month` · `GET /goals/suggest?month`.

**Reportes** (`routes/reports.ts`)
- `GET /reports/pnl|products|channels|clients|expenses|inflation?from&to` (+ `/export` cada uno) · `GET /reports/full/export`.
- `GET/PUT/DELETE /inflation[/:month]`.

**Calculadora** (`routes/calculator.ts`): `GET /calculator/context`.

**Eventos** (`routes/events.ts`): `GET /events` (con resumen por evento) · `GET /events/:id` · `POST/PUT/DELETE` · `POST /events/:id/open-bottles` · `GET /events/export`.

**Configuración** (`routes/settings.ts`): `GET/PUT /settings` · `GET/POST /backups` · `GET /backups/:file/download` · `POST /backups/:file/restore` · `POST /backups/restore-upload` · `GET /export/all` · `POST /demo/load` · `POST /data/reset`.

## 5. Convenciones de la interfaz

- **Idioma**: castellano rioplatense con voseo ("Cargá", "Mirá", "¿Ya lo cobraste?"). Tono descontracturado pero claro. Nombrar las cosas como las llama la gente del negocio, nunca como se llaman en la base.
- **Siempre** usar el kit `@/components/ui` y `@/components/charts`. Nada de estilos sueltos que repitan lo que ya hay.
- Cada pantalla: `PageHeader` (título + descripción + acciones) → `HelpBox` ("¿Para qué sirve esta pantalla?", con ejemplos y el porqué) → contenido.
- Cada número importante lleva su `InfoTip term="..."` (glosario en `lib/glossary.ts`) o un texto explicativo.
- Una sola acción `variant="primary"` por pantalla. Borrar siempre con `useConfirm()` (`danger: true`).
- Datos: `useApi<T>(path, params)` para leer; `useApiMutation(fn, { success: 'Venta guardada' })` para escribir (refresca todo y avisa con un toast).
- Período: `usePeriod()` (compartido entre pantallas) + `<PeriodPicker/>`.
- Plata: `money()`, `moneyCompact()`, `<Money/>`; porcentajes `pct()`; fechas `date()`, `dateShort()`.
- Formularios en `Modal`. Campos: `Field` + `TextInput` / `MoneyInput` / `IntInput` / `DateInput` / `Select` / `ChoiceCards` / `ProductSelect` / `ClientSelect` / `SupplierSelect` / `AccountSelect` / `EventSelect`.
- Listas: `DataTable` (búsqueda, orden, paginado, totales) con `EmptyState` cuando no hay nada (y botón para cargar el primero).
- Exportar: `<ExportButton path="/sales/export" params={{ from, to }} />`.
- Botones rápidos de arriba: abren `/ventas?nuevo=1`, `/gastos?nuevo=1`, `/compras?nuevo=1`. Cada pantalla usa `useNewParam()` para abrir su formulario. Además, `?evento=ID` preselecciona el evento en ventas y gastos.
- Colores por grupo del menú (`lib/nav.ts`): naranja = Cómo venimos, celeste = Entra plata, coral = Sale plata, mostaza = Los vinos, marrón = Herramientas.
- Colores de gráficos fijos por concepto (`CHART_COLORS`): ventas azul, gastos coral, costo mostaza, ganancia verde azulado. Los gráficos llevan tabla alternativa (`ChartCard table={…}`).

## 6. Calidad

- `npm run typecheck` y `npm test` tienen que pasar.
- Tests de lógica en `server/tests/*.test.ts`; para probar rutas usar `startTestServer()` de `server/tests/helpers.ts` (base en memoria).
