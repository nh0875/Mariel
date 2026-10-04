// Preguntas frecuentes de la Ayuda: "¿Cómo hago para…?". Cada respuesta dice dónde tocar y por qué.
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

export interface FaqItem {
  id: string
  q: string
  /** Palabras extra para la búsqueda. */
  keywords?: string
  a: ReactNode
}

const L = ({ to, children }: { to: string; children: ReactNode }) => (
  <Link to={to} className="font-bold text-sky-deep underline-offset-2 hover:underline">
    {children}
  </Link>
)

const Steps = ({ children }: { children: ReactNode }) => <ol className="my-2 ml-5 list-decimal space-y-1 marker:font-extrabold marker:text-brown">{children}</ol>
const Why = ({ children }: { children: ReactNode }) => (
  <p className="mt-2 rounded-xl bg-cream-deep/70 px-3 py-2 text-[14px]">
    <b>¿Por qué así?</b> {children}
  </p>
)

export const FAQ: FaqItem[] = [
  {
    id: 'faq-venta-a-cuenta',
    q: '¿Cómo cargo una venta a cuenta (que me pagan después)?',
    keywords: 'fiado debe deuda cliente cuenta corriente vencimiento',
    a: (
      <>
        <Steps>
          <li>
            Tocá <b>+ Venta</b> arriba (o andá a <L to="/ventas?nuevo=1">Ventas → Nueva venta</L>).
          </li>
          <li>Elegí el cliente (si no existe, escribí su nombre y tocá «Agregar cliente») y cargá los vinos.</li>
          <li>
            En <b>«¿Ya la cobraste?»</b> elegí <b>«No, me la pagan después»</b>. Si acordaron una fecha, ponela como vencimiento.
          </li>
        </Steps>
        Queda como <b>«Por cobrar»</b> en Ventas, en la ficha del cliente y en Caja y bancos → «Por cobrar y por pagar». Si se pasa la fecha, el sistema la marca como vencida.
        <Why>La venta cuenta en el resultado del día que vendiste (el vino ya salió), pero la plata entra a la caja recién cuando te pagan.</Why>
      </>
    ),
  },
  {
    id: 'faq-registrar-cobro',
    q: '¿Cómo registro que me pagaron una venta?',
    keywords: 'cobro pago parcial seña cobrar',
    a: (
      <>
        <Steps>
          <li>
            Andá a <L to="/ventas">Ventas</L> y tocá la venta (filtrá por «Por cobrar» para encontrarla rápido).
          </li>
          <li>
            Tocá <b>«Registrar cobro»</b>: poné cuánto te pagaron, la fecha y en qué cuenta entró la plata.
          </li>
        </Steps>
        Puede ser un pago parcial (una seña): la venta queda en «Cobro parcial» hasta completar. También podés cobrar desde <L to="/caja">Caja y bancos</L> → pestaña «Por cobrar y por pagar» →
        «Cobrar».
        <Why>Así la caja de cada cuenta coincide con la real y sabés exactamente quién te debe y cuánto.</Why>
      </>
    ),
  },
  {
    id: 'faq-anular-venta',
    q: '¿Cómo anulo o corrijo una venta?',
    keywords: 'borrar eliminar error equivocación devolución editar',
    a: (
      <>
        <Steps>
          <li>
            En <L to="/ventas">Ventas</L>, tocá la venta para abrir el detalle.
          </li>
          <li>
            Para corregirla tocá <b>«Editar»</b>; para anularla del todo, <b>«Borrar»</b>.
          </li>
        </Steps>
        Al borrarla, las botellas vuelven al stock y se borran sus cobros y comisiones. Si el cliente te devolvió solo algunas botellas, mirá{' '}
        <L to="/ayuda#faq-devolucion">cómo cargo una devolución</L>.
        <Why>Todo se recalcula solo (stock, costo, caja y reportes), así los números siempre cierran aunque te hayas equivocado.</Why>
      </>
    ),
  },
  {
    id: 'faq-devolucion',
    q: '¿Cómo cargo que un cliente me devolvió una botella?',
    keywords: 'devolución devolver cambio cliente reintegro botella vuelve stock',
    a: (
      <>
        <Steps>
          <li>
            En <L to="/ventas">Ventas</L>, buscá la venta de esa botella y abrila.
          </li>
          <li>
            Tocá <b>«Editar»</b>, sacá la botella devuelta (o bajá la cantidad) y guardá. Si te devolvió todo, podés <b>«Borrar»</b> la venta.
          </li>
          <li>Si le devolviste la plata, en el detalle de la venta borrá o corregí el cobro (o cargá el reintegro como movimiento en Caja).</li>
          <li>Si fue un cambio por otro vino, agregá el vino nuevo en esa misma venta.</li>
        </Steps>
        No se carga en «Ajustar stock»: ahí la botella volvería al stock pero la venta seguiría contando como vendida.
        <Why>Corrigiendo la venta, todo queda en su lugar: la botella vuelve al stock, la venta y su ganancia bajan, y la caja coincide con lo que pasó de verdad.</Why>
      </>
    ),
  },
  {
    id: 'faq-compra-con-flete',
    q: '¿Cómo cargo una compra de vino con flete?',
    keywords: 'envío bodega proveedor factura costo transporte',
    a: (
      <>
        <Steps>
          <li>
            Tocá <b>+ Compra</b> arriba (o <L to="/compras?nuevo=1">Compras de vino → Nueva compra</L>).
          </li>
          <li>Elegí el proveedor y cargá cada vino con las botellas y el precio por botella de la factura.</li>
          <li>
            Poné el flete (y otros costos de esa compra) en el campo de <b>flete / envío</b>. Indicá si ya la pagaste o si queda por pagar.
          </li>
        </Steps>
        El sistema reparte el flete entre las botellas, proporcional al precio de cada vino. Ejemplo: $ 40.000 de vino + $ 4.000 de flete → cada botella cuesta 10 % más que en la factura.
        <Why>
          Así el costo de cada botella es el real («puesto en tu depósito») y el margen no te miente. Ver <L to="/ayuda#flete_prorrateado">flete repartido en el costo</L>.
        </Why>
      </>
    ),
  },
  {
    id: 'faq-subir-precios',
    q: '¿Cómo subo todos los precios de una vez?',
    keywords: 'aumento inflación lista de precios porcentaje remarcar',
    a: (
      <>
        <Steps>
          <li>
            En <L to="/vinos">Vinos y stock</L>, tocá <b>«Aumentar precios»</b>.
          </li>
          <li>Poné el porcentaje y elegí a qué vinos (todos, una bodega o un tipo), si es el precio minorista, el mayorista o los dos, y cómo redondear.</li>
          <li>Mirá la vista previa «Así quedarían» y confirmá.</li>
        </Steps>
        Después podés bajar la lista de precios nueva desde «Lista de precios».
        <Why>Con inflación, si el costo sube y el precio no, tu margen se achica sin que te des cuenta. Conviene revisar seguido.</Why>
      </>
    ),
  },
  {
    id: 'faq-contar-stock',
    q: '¿Cómo cuento el stock (arqueo de inventario)?',
    keywords: 'inventario contar botellas faltante sobrante depósito ajuste',
    a: (
      <>
        <Steps>
          <li>Contá las botellas de cada vino en el depósito.</li>
          <li>
            En <L to="/vinos">Vinos y stock</L> abrí cada vino que no coincida → <b>«Ajustar stock»</b> → <b>«Conté y hay otra cantidad»</b>.
          </li>
          <li>Escribí cuántas contaste: el sistema calcula la diferencia y la registra.</li>
        </Steps>
        Si faltan botellas, cuentan como merma (a su costo). Si sobran, vuelven al stock y son un <b>sobrante</b>: restan de las mermas (a costo), así que el resultado sube un poco. Ojo: si
        sobra porque un cliente te la devolvió, eso se carga corrigiendo la venta, no acá.
        <Why>Un stock que no coincide con la realidad te hace pedir de más o quedarte sin vino. Contar una vez por mes alcanza para tenerlo al día.</Why>
      </>
    ),
  },
  {
    id: 'faq-botella-rota',
    q: '¿Cómo registro una botella rota (o una que abrí para degustar)?',
    keywords: 'rotura merma degustación regalo muestra consumo',
    a: (
      <>
        <Steps>
          <li>
            Abrí el vino en <L to="/vinos">Vinos y stock</L> → <b>«Ajustar stock»</b>.
          </li>
          <li>Elegí qué pasó (rotura, degustación, regalo, consumo interno…), cuántas botellas y, si fue en un evento, cuál.</li>
        </Steps>
        Se valoriza al costo promedio y aparece como <b>«Mermas, degustaciones y regalos»</b> en el resultado.
        <Why>
          Esas botellas te costaron plata aunque no las vendiste: si no las cargás, el sistema cree que ganaste más. Ver <L to="/ayuda#mermas">mermas</L>.
        </Why>
      </>
    ),
  },
  {
    id: 'faq-ganancia-evento',
    q: '¿Cómo sé cuánto ganó un evento o una degustación?',
    keywords: 'feria cata evento resultado rentabilidad',
    a: (
      <>
        <Steps>
          <li>
            Creá el evento en <L to="/eventos">Eventos</L>.
          </li>
          <li>
            Cuando cargues las ventas y los gastos de ese evento, elegilo en el campo «Evento». Más fácil: desde la ficha del evento, <b>«Cargar venta del evento»</b>,{' '}
            <b>«Vender entradas»</b> y <b>«Cargar gasto del evento»</b> ya lo traen elegido (y con la fecha del evento, si ya pasó).
          </li>
          <li>
            En la ficha del evento, tocá <b>«Registrar botellas abiertas»</b> para las que abriste para degustar.
          </li>
        </Steps>
        La ficha del evento te muestra lo que vendiste, lo que te costaron esos vinos, las comisiones, los gastos y las botellas abiertas: el resultado del evento.
        <Why>Un evento puede vender mucho y aun así perder plata. Mirando el resultado decidís si conviene repetirlo.</Why>
      </>
    ),
  },
  {
    id: 'faq-mp-al-banco',
    q: '¿Cómo paso plata de Mercado Pago al banco?',
    keywords: 'transferencia mover plata cuenta retirar mp',
    a: (
      <>
        <Steps>
          <li>
            En <L to="/caja">Caja y bancos</L>, tocá <b>«Transferir entre cuentas»</b>.
          </li>
          <li>«Sale de»: Mercado Pago · «Va a»: Banco · el monto y la fecha.</li>
        </Steps>
        Lo mismo sirve para depositar el efectivo de la caja en el banco.
        <Why>Una transferencia no es ingreso ni gasto: la plata sigue siendo tuya, solo cambia de lugar. Por eso no toca el resultado.</Why>
      </>
    ),
  },
  {
    id: 'faq-retiro',
    q: '¿Cómo registro que me llevé plata (un retiro)?',
    keywords: 'retiro sueldo dueña socio aporte sacar plata',
    a: (
      <>
        <Steps>
          <li>
            En <L to="/caja">Caja y bancos</L>, tocá <b>«Nuevo movimiento»</b>.
          </li>
          <li>
            En «¿Qué fue?» elegí <b>«Retiro de socios / dueños»</b>, la cuenta de donde salió y el monto.
          </li>
        </Steps>
        Si al revés pusiste plata tuya en el negocio, es un «Aporte de socios / dueños».
        <Why>
          Lo que te llevás no es un gasto del negocio: es tu ganancia. Por eso baja la caja pero no el resultado. Ver <L to="/ayuda#aportes_retiros">aportes y retiros</L>.
        </Why>
      </>
    ),
  },
  {
    id: 'faq-gastos-fijos',
    q: '¿Cómo cargo el alquiler y los sueldos sin repetirlos cada mes?',
    keywords: 'gastos fijos recurrentes mensuales generar alquiler sueldos',
    a: (
      <>
        <Steps>
          <li>
            En <L to="/gastos">Gastos</L>, andá a la pestaña <b>«Gastos fijos del mes»</b> y cargá cada uno una sola vez (monto, día del mes, categoría).
          </li>
          <li>
            Cada mes tocá <b>«Generar los gastos del mes»</b>: se cargan todos juntos.
          </li>
        </Steps>
        Si un mes cambió el monto, editá ese gasto puntual. Es seguro apretar «Generar» más de una vez: no los duplica.
        <Why>Te ahorra tiempo y evita olvidos: un alquiler sin cargar hace que el mes parezca mucho mejor de lo que fue.</Why>
      </>
    ),
  },
  {
    id: 'faq-excel',
    q: '¿Cómo saco todo a Excel?',
    keywords: 'exportar planilla contador descargar xlsx',
    a: (
      <>
        Cada pantalla tiene su botón <b>«Descargar Excel»</b> con el período que estás mirando. Para tener absolutamente todo junto, andá a{' '}
        <L to="/configuracion#datos">Configuración → Tus datos → «Descargar todo en Excel»</L>: es un archivo con 16 hojas (vinos, ventas, compras, gastos, caja, clientes…) y una hoja «Léeme» que
        explica cada una.
        <Why>Los Excel salen con formato de pesos, fechas reales, filtros y una explicación abajo de cada tabla: listos para el contador.</Why>
      </>
    ),
  },
  {
    id: 'faq-copia',
    q: '¿Cómo hago una copia de seguridad?',
    keywords: 'backup respaldo copia restaurar pendrive perder datos',
    a: (
      <>
        No tenés que hacer nada: <b>todos los días se guarda una copia automática</b> (y antes de borrar o restaurar algo, también). Si querés una en el momento, andá a{' '}
        <L to="/configuracion#backups">Configuración → Copias de seguridad</L> → <b>«Hacer una copia ahora»</b>. Para tenerla fuera de la compu, tocá «Descargar» y guardala en un pendrive o mandátela
        por mail.
        <Why>Si la compu se rompe o te la roban, la copia en otro lado es lo único que salva tus datos. Una vez por semana está bien.</Why>
      </>
    ),
  },
  {
    id: 'faq-calculadora',
    q: '¿Cómo uso la calculadora de precios?',
    keywords: 'precio margen markup calcular cuánto cobrar punto de equilibrio',
    a: (
      <>
        En <L to="/calculadora">Calculadora</L> elegís qué querés saber: <b>a cuánto vender</b> un vino (ponés el costo o elegís el vino, y el margen que querés), <b>cuánto te deja</b> un precio que
        ya tenés, o <b>cuánto tenés que vender</b> por mes para no perder plata (punto de equilibrio). Usa las comisiones, el IVA y los Ingresos Brutos que cargaste en Configuración.
        <Why>
          El error más común es sumarle un 40 % al costo y creer que ganás 40 %: ganás 28,6 %. La calculadora hace la cuenta bien. Ver <L to="/ayuda#margen_vs_markup">margen vs. markup</L>.
        </Why>
      </>
    ),
  },
  {
    id: 'faq-resultado-vs-caja',
    q: '¿Por qué el resultado no coincide con la plata que hay en la caja?',
    keywords: 'gané pero no tengo plata devengado percibido diferencia caja resultado',
    a: (
      <>
        Porque miden cosas distintas. El <b>resultado</b> cuenta lo que vendiste y gastaste en el período; la <b>caja</b>, lo que efectivamente cobraste y pagaste. Las diferencias más comunes:
        <ul className="my-2 ml-5 list-disc space-y-1">
          <li>Ventas a cuenta: suman al resultado hoy, a la caja cuando te pagan.</li>
          <li>Compras de vino: bajan la caja, pero no son gasto (son stock) hasta que vendés las botellas.</li>
          <li>Gastos sin pagar: restan al resultado, todavía no a la caja.</li>
          <li>Retiros y aportes de los dueños: mueven la caja, no el resultado.</li>
        </ul>
        <Why>
          Los dos importan: el resultado dice si el negocio es bueno; la caja, si podés pagar las cuentas este mes. Mirá el ejemplo en <L to="/ayuda#como-calcula">Cómo calcula el sistema</L>.
        </Why>
      </>
    ),
  },
  {
    id: 'faq-arqueo-caja',
    q: '¿Qué hago si la plata de la caja no coincide con el sistema?',
    keywords: 'arqueo contar plata diferencia sobra falta ajuste',
    a: (
      <>
        Contá la plata real y hacé un <b>arqueo</b>: en <L to="/caja">Caja y bancos</L>, menú ⋮ de la cuenta → «Hacer arqueo». Escribís cuánto contaste y el sistema registra la diferencia como «Ajuste
        de saldo». Antes, fijate si te faltó cargar alguna venta, gasto o retiro: casi siempre la diferencia es eso.
        <Why>
          Hacerlo seguido evita que los errores se acumulen y después no sepas de dónde vienen. Ver <L to="/ayuda#arqueo">arqueo de caja</L>.
        </Why>
      </>
    ),
  },
  {
    id: 'faq-costo-subio',
    q: 'Me aumentó el costo de un vino, ¿qué hago?',
    keywords: 'costo aumento bodega revalúo cambiar costo precio',
    a: (
      <>
        Si lo compraste más caro, alcanza con <b>cargar la compra</b> con el precio nuevo: el costo promedio se actualiza solo. Si querés revaluarlo sin una compra (por ejemplo, para fijar el costo de
        reposición), abrí el vino en <L to="/vinos">Vinos y stock</L> → <b>«Cambiar costo»</b>. Después revisá su precio de venta.
        <Why>El costo de cada botella define tu margen: si queda viejo, el sistema te muestra ganancias que en la reposición ya no existen.</Why>
      </>
    ),
  },
  {
    id: 'faq-meta',
    q: '¿Cómo me pongo una meta de ventas para el mes?',
    keywords: 'objetivo meta presupuesto mes',
    a: (
      <>
        En <L to="/metas">Metas</L> cargás cuánto querés vender (en pesos y en botellas) y cuánto pensás gastar cada mes. El sistema te sugiere un piso: tu punto de equilibrio. En Inicio vas viendo
        cuánto te falta.
        <Why>Sin meta no hay forma de saber si un mes fue bueno o malo. Y arrancar por el punto de equilibrio te asegura no perder plata.</Why>
      </>
    ),
  },
  {
    id: 'faq-borrar-ejemplo',
    q: '¿Cómo saco los datos de ejemplo y empiezo con los míos?',
    keywords: 'ejemplo demo borrar empezar de cero',
    a: (
      <>
        Andá a <L to="/configuracion#datos">Configuración → Tus datos</L> → <b>«Borrar todo»</b> y escribí BORRAR para confirmar. Se borran los datos pero se mantiene tu configuración, y te llevamos a
        la bienvenida para cargar tus saldos.
        <Why>Antes de borrar se guarda una copia de seguridad, así que si te arrepentís, la restaurás.</Why>
      </>
    ),
  },
]
