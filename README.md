# 🍷 VINOH! Finanzas

**El sistema para llevar las cuentas de VINOH! — Viví el vino.**
Ventas, compras, gastos, stock de vinos, caja, costos, metas y reportes, con gráficos, explicaciones en cada número y todo exportable a Excel.

Funciona **solo en tu computadora** (no está en internet): tus datos no salen de ahí y no hay que pagar ningún servicio.

---

## 🚀 Cómo abrirlo (la primera vez)

1. **Instalá Node.js** (es gratis, se hace una sola vez): entrá a <https://nodejs.org/es/download>, bajá la versión **LTS** e instalala con "Siguiente, siguiente, finalizar".
2. **Abrí VINOH! con doble clic** en el archivo que corresponda a tu computadora:
   - Windows → **`INICIAR-VINOH-Windows.bat`**
   - Mac → **`INICIAR-VINOH-Mac.command`** (la primera vez: clic derecho → *Abrir* → *Abrir*, porque macOS pregunta por archivos descargados)
   - Linux → `./iniciar-vinoh-linux.sh`
3. La primera vez tarda unos minutos (instala lo necesario; hace falta internet solo esa vez). Después se abre solo el navegador en **http://localhost:3030**.
4. Te recibe una bienvenida: podés **probar con datos de ejemplo** (para jugar sin miedo) o **empezar con tus datos**.

> 💡 **Mientras uses el sistema, dejá abierta la ventanita negra** que aparece: es el "motor". Para cerrar VINOH!, cerrá esa ventana.
>
> 💡 Podés agregar `http://localhost:3030` a favoritos del navegador, pero el programa tiene que estar abierto (paso 2) para que funcione.

## 🗺️ Qué hay adentro

| Sección | Para qué sirve |
|---|---|
| **Inicio** | "¿Cómo venimos?": resultado del mes, ventas, margen, caja, alertas (stock bajo, deudas vencidas) y frases que te explican tus números. |
| **Caja y bancos** | Cuánta plata hay y dónde (efectivo, banco, Mercado Pago). Cobros y pagos pendientes, transferencias, retiros, arqueo. |
| **Reportes** | Estado de resultados mes a mes, rentabilidad por vino (análisis ABC), canales, clientes, gastos e inflación. |
| **Metas** | Objetivos de venta y presupuesto de gastos por mes, con sugerencias (punto de equilibrio, año pasado + inflación). |
| **Ventas** | Cargar ventas en segundos (con precio minorista o mayorista, descuentos, envío, comisión del medio de pago) y ver si están cobradas. |
| **Clientes** | Quién te compra, cuánto, qué vinos prefiere y quién te debe. |
| **Eventos** | Degustaciones, ferias y catas: ¿cuánto dejó cada evento? |
| **Compras de vino** | Lo que le comprás a bodegas. Reparte el flete en el costo de cada botella y actualiza el costo promedio. |
| **Gastos** | Alquiler, sueldos, envíos… Fijos y variables, con plantillas que se generan cada mes. |
| **Proveedores** | Bodegas y servicios, cuánto les compraste y cuánto les debés. |
| **Vinos y stock** | Catálogo, precios, márgenes, stock, alertas, ajustes de inventario, aumento masivo de precios, lista de precios e importación desde Excel. |
| **Calculadora** | ¿A cuánto lo vendo? ¿Cuánto gano? ¿Cuánto tengo que vender para no perder? ¿Qué pasa si sube la bodega? |
| **Ayuda** | Guía paso a paso, preguntas frecuentes y un diccionario con cada concepto explicado. |
| **Configuración** | Datos del negocio, comisiones de cada medio de pago, categorías de gastos, dólar de referencia, copias de seguridad. |

En todas las pantallas vas a ver un **💡 "¿Para qué sirve esta pantalla?"** y un **ⓘ** al lado de cada número: pasá el mouse y te explica qué es, cómo se calcula y por qué importa.

## 💾 Tus datos y las copias de seguridad

- Todo se guarda en la carpeta **`data/`** (archivo `vinoh.db`).
- **Todos los días se hace una copia de seguridad automática** en `data/backups/`: al abrir el programa y, si lo dejás abierto varios días, igual una por día. Se guardan las automáticas de los últimos 30 días y, aparte, hasta 30 copias hechas a mano o «de seguridad» (antes de borrar todo, cargar el ejemplo o restaurar).
- Desde **Configuración → Copias de seguridad** podés hacer una copia en el momento, descargarla o volver a una copia anterior.
- Recomendación: una vez por semana descargá una copia y guardala en un pendrive o en tu nube (Google Drive, Dropbox…).
- Antes de restaurar, el programa revisa que la copia esté sana (si está dañada o es de una versión más nueva, no la usa y tus datos no se tocan).
- Para pasar el sistema a otra computadora: **primero cerrá VINOH!** (la ventanita negra, así se guarda todo en `vinoh.db`) y copiá la carpeta completa (incluida `data/`). La primera vez que lo abras en la otra computadora, VINOH! se da cuenta de que viene de otra máquina y reinstala lo necesario para esa (hace falta internet esa vez). Otra opción: instalalo de nuevo, descargá una copia en la computadora vieja (**Configuración → Copias de seguridad → Descargar**) y en la nueva usá **«Restaurar desde un archivo»**.
- Desde **Configuración → Datos** podés descargar **todo en un Excel**.

## 🧮 ¿Cómo hace las cuentas?

- **Resultado** = Ventas − Costo de los vinos vendidos − Comisiones de cobro − Mermas (roturas, degustaciones, regalos) − Gastos.
- **Comprar vino no es un gasto**: la plata se convierte en stock y pasa a ser costo cuando vendés la botella.
- El **costo de cada botella** es el promedio ponderado de tus compras (más la parte del flete).
- El **resultado** cuenta lo que vendiste y gastaste; la **caja**, lo que cobraste y pagaste. Por eso pueden no coincidir (y está bien).
- Todos los montos se cargan **en pesos y con impuestos incluidos**, como figuran en el ticket o la factura. El dólar es solo de referencia.

Todo esto está explicado con ejemplos en **Ayuda** dentro del programa.

---

## 🛠️ Para quien mantenga el sistema (técnico)

- Requisitos: Node.js ≥ 22.13 (usa `node:sqlite`, no hay que compilar nada).
- `npm install` · `npm run dev` (API en :3030 + interfaz con recarga en :5173) · `npm run build` · `npm start` · `npm test` · `npm run typecheck` · `npm run demo` (carga datos de ejemplo en `data/`).
- Variables: `PORT` (default 3030), `VINOH_DATA_DIR` (default `./data`; `:memory:` para tests), `VINOH_OPEN_BROWSER=1`.
- El servidor escucha solo en `127.0.0.1` y solo atiende pedidos dirigidos a `localhost`/`127.0.0.1`; todo lo que cambia datos (POST/PUT/DELETE) tiene que traer el encabezado `X-VINOH: 1` (lo manda `client/src/lib/api.ts`). Así una página web de afuera no puede borrar ni leer los datos (ver `server/lib/guard.ts`). Si escribís scripts contra la API, agregá ese encabezado.
- El lanzador (`scripts/iniciar.mjs`) guarda en `node_modules/.vinoh-platform` para qué sistema se instaló y prueba que los módulos nativos (esbuild, rolldown, lightningcss, tailwind) carguen; si la carpeta vino de otra computadora, reinstala solo.
- Arquitectura, modelo contable y contratos de la API: [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md).
