// Diccionario de conceptos. Lo usan los "?" de cada número (InfoTip) y la página de Ayuda.
// Regla: explicar como se lo explicarías a alguien que sabe mucho de vinos y poco de números.

export interface GlossaryEntry {
  title: string
  /** Una línea: qué es. */
  short: string
  /** Explicación más larga. */
  long?: string
  /** Cómo se calcula en el sistema. */
  formula?: string
  /** Ejemplo con números. */
  example?: string
  /** Por qué te importa. */
  why?: string
  group: 'Resultados' | 'Costos y precios' | 'Stock' | 'Caja y deudas' | 'Impuestos y contexto'
}

export const GLOSSARY = {
  ventas: {
    group: 'Resultados',
    title: 'Ventas',
    short: 'Todo lo que te pagaron (o te van a pagar) los clientes en el período.',
    long: 'Suma el total de cada venta: precio de los vinos menos descuentos, más el envío que le cobraste al cliente. Cuenta el día que vendiste, aunque te paguen después.',
    formula: 'Σ (cantidad × precio) − descuentos + envíos cobrados',
    why: 'Es el punto de partida, pero vender mucho no alcanza: importa cuánto te queda.',
  },
  cmv: {
    group: 'Resultados',
    title: 'Costo de lo vendido (CMV)',
    short: 'Lo que te costaron las botellas que vendiste.',
    long: 'Cada botella vendida se valoriza a su costo promedio en el momento de la venta. No es lo que compraste en el mes: es el costo de lo que efectivamente salió vendido.',
    formula: 'Σ (botellas vendidas × costo promedio de cada una)',
    example: 'Vendiste 10 Malbec que te costaban $8.000 cada uno → CMV = $80.000.',
    why: 'Sin el CMV no sabés si ganás plata con cada botella o solo movés stock.',
  },
  ganancia_bruta: {
    group: 'Resultados',
    title: 'Ganancia bruta',
    short: 'Ventas menos lo que te costaron los vinos vendidos (antes de comisiones y gastos).',
    long: 'Se llama igual en Inicio, Reportes y Vinos. Si además le restás las comisiones de cobro, es lo que en Ventas figura como «Te quedó».',
    formula: 'Ventas − CMV',
    example: 'Vendiste $150.000 en vinos que te costaron $90.000 → ganancia bruta $60.000.',
    why: 'Es la plata que te queda para pagar alquiler, sueldos, envíos… y ganar.',
  },
  margen_bruto: {
    group: 'Resultados',
    title: 'Margen bruto',
    short: 'De cada $100 que vendés, cuántos te quedan después de pagar el vino.',
    formula: '(Ventas − CMV) ÷ Ventas × 100',
    example: 'Margen 40 % → de cada $100 vendidos, $40 quedan para gastos y ganancia.',
    why: 'En vinotecas suele andar entre 30 % y 50 %. Si baja mes a mes, revisá precios: probablemente subió el costo y no lo trasladaste.',
  },
  te_quedo: {
    group: 'Resultados',
    title: 'Te quedó (después de comisiones)',
    short: 'Lo que te dejaron las ventas después de pagar el vino y la comisión del medio de cobro. Todavía sin gastos fijos ni variables.',
    long: 'Es la ganancia bruta menos las comisiones (Mercado Pago, tarjetas). Lo vas a ver en Ventas, en el detalle de cada venta, en cada evento y en Reportes → Canales y Clientes. No es el resultado final: a esto todavía le faltan las mermas y los gastos (eso está en Inicio y en Reportes → Estado de resultados).',
    formula: 'Ventas − costo del vino − comisiones',
    example: 'Venta de $10.000 por Mercado Pago, el vino te costó $6.000 y MP se queda $629 → te quedaron $3.371.',
    why: 'Sirve para comparar canales y medios de cobro: una venta con comisión alta te deja menos aunque el precio sea el mismo.',
  },
  gastos: {
    group: 'Resultados',
    title: 'Gastos',
    short: 'Todo lo que pagás para que el negocio funcione (que no sea comprar vino).',
    long: 'Alquiler, sueldos, servicios, envíos, packaging, marketing, contador, impuestos… Se cuentan en la fecha del gasto, aunque los pagues después.',
    why: 'Comprar vino NO es un gasto (es stock). Los gastos son lo que se va y no vuelve.',
  },
  gastos_fijos: {
    group: 'Costos y precios',
    title: 'Gastos fijos',
    short: 'Los que pagás igual, vendas mucho o poco.',
    example: 'Alquiler, sueldos, internet, contador, software.',
    why: 'Son los que tenés que cubrir sí o sí cada mes. Con ellos se calcula el punto de equilibrio.',
  },
  gastos_variables: {
    group: 'Costos y precios',
    title: 'Gastos variables',
    short: 'Los que suben o bajan según cuánto vendés.',
    example: 'Envíos, packaging, comisiones, publicidad por venta.',
    why: 'Se comen parte de cada venta. Si crecen más rápido que las ventas, algo se está desordenando.',
  },
  comisiones: {
    group: 'Costos y precios',
    title: 'Comisiones de cobro',
    short: 'Lo que se quedan Mercado Pago, las tarjetas o el posnet al cobrar.',
    long: 'Se calcula solo con el % que configuraste para cada medio de pago (Configuración → Medios de pago) y se descuenta de la cuenta donde entra la plata.',
    formula: 'Total de la venta × % de comisión del medio de pago',
    example: 'Venta de $20.000 por Mercado Pago al 6,29 % → comisión $1.258.',
    why: 'Parece poco, pero en un mes pueden ser varios vinos regalados al banco. Conviene saber cuánto es.',
  },
  mermas: {
    group: 'Stock',
    title: 'Mermas, degustaciones y regalos',
    short: 'Botellas que salieron sin venderse: rotas, abiertas para degustar, regaladas o que faltan al contar. Si al contar sobran (un «sobrante»), restan.',
    formula: 'Botellas × costo promedio (los sobrantes, en negativo)',
    why: 'Son costo puro. Las degustaciones pueden ser una inversión en ventas; las roturas y faltantes, no. Un sobrante son botellas que tenías y el sistema no sabía: suma al resultado a su costo.',
  },
  resultado: {
    group: 'Resultados',
    title: 'Resultado (ganancia o pérdida)',
    short: 'Lo que realmente ganaste (o perdiste) en el período.',
    formula: 'Ventas − CMV − comisiones − mermas − gastos',
    why: 'Es EL número. Si es positivo, el negocio gana plata; si es negativo, la pierde, aunque haya plata en la caja.',
  },
  margen_neto: {
    group: 'Resultados',
    title: 'Margen neto',
    short: 'De cada $100 que vendés, cuántos son ganancia final.',
    formula: 'Resultado ÷ Ventas × 100',
    example: 'Margen neto 12 % → de cada $100 vendidos, $12 son ganancia.',
  },
  gastos_sobre_ventas: {
    group: 'Resultados',
    title: 'Gastos sobre ventas',
    short: 'Qué parte de lo que vendiste se fue en gastos (alquiler, sueldos, envíos…).',
    formula: 'Gastos ÷ Ventas × 100',
    example: 'Vendiste $5.000.000 y gastaste $1.250.000 → 25 %: de cada $100 vendidos, $25 se fueron en gastos.',
    long: 'No incluye el costo del vino (ese ya se descuenta en el margen bruto) ni las compras de vino, que son mercadería.',
    why: 'Si sube mes a mes, los gastos crecen más rápido que las ventas: es lo primero que se come la ganancia.',
  },
  resultado_evento: {
    group: 'Resultados',
    title: 'Resultado de un evento',
    short: '¿El evento dejó plata o la pusiste vos?',
    formula: 'Entradas + ventas de vino − costo del vino vendido − comisiones − gastos del evento − botellas abiertas',
    example: '25 entradas a $8.000 ($200.000) + vino $350.000 − vino vendido $180.000 − gastos $120.000 − botellas abiertas $45.000 → resultado $205.000.',
    why: 'Un evento es una inversión: con esto sabés cuáles conviene repetir. Cuenta todo lo que cargues eligiendo el evento.',
  },
  retorno_evento: {
    group: 'Resultados',
    title: 'Retorno de un evento',
    short: 'Cuánto ganaste por cada peso que pusiste para hacer el evento.',
    formula: 'Resultado del evento ÷ (gastos del evento + botellas abiertas) × 100',
    example: 'Pusiste $100.000 y el resultado fue $50.000 → retorno 50 %: recuperaste lo puesto y ganaste la mitad encima. Negativo = no se recuperó.',
  },
  ticket_promedio: {
    group: 'Resultados',
    title: 'Ticket promedio',
    short: 'Cuánto gasta en promedio cada cliente por compra.',
    formula: 'Ventas ÷ cantidad de ventas',
    why: 'Subir el ticket (sugerir un segundo vino, armar cajas) suele ser más fácil que conseguir clientes nuevos.',
  },
  markup: {
    group: 'Costos y precios',
    title: 'Markup (recargo sobre el costo)',
    short: 'Cuánto le sumás al costo para llegar al precio.',
    formula: '(Precio − Costo) ÷ Costo × 100',
    example: 'Costo $6.000, precio $10.000 → markup 66,7 %.',
  },
  margen_vs_markup: {
    group: 'Costos y precios',
    title: 'Margen vs. markup (¡no son lo mismo!)',
    short: 'Markup se calcula sobre el costo; margen, sobre el precio.',
    long: 'Si a un vino de $6.000 le sumás 40 % (markup), lo vendés a $8.400 y tu margen es 28,6 %, no 40 %. Para tener 40 % de margen tenés que venderlo a $10.000 (markup 66,7 %).',
    formula: 'Precio para un margen M = Costo ÷ (1 − M)',
    why: 'Confundirlos es el error de precios más común: creés que ganás 40 % y ganás bastante menos.',
  },
  margen_despues_iibb: {
    group: 'Costos y precios',
    title: 'Margen después de IIBB y comisión',
    short: 'Lo que te queda de cada botella después de pagar el vino, Ingresos Brutos y la comisión del cobro, sobre el precio.',
    long: 'Es el margen que usa la Calculadora («¿A cuánto lo vendo?»). En Vinos y stock, Reportes y Configuración se usa el margen bruto (antes de IIBB y comisión). Por eso, con el mismo % objetivo, la Calculadora sugiere un precio un poco más alto: también reserva lugar para el impuesto y la comisión.',
    formula: '(Precio − costo − IIBB − comisión) ÷ Precio × 100',
    example: 'Costo $6.000, 40 % y 3,5 % de IIBB, en efectivo: margen bruto → $10.000; después de IIBB → 6.000 ÷ (1 − 0,40 − 0,035) = $10.619 (redondeado, $10.700).',
    why: 'Semáforo de la Calculadora: 35 % o más es sano, entre 25 % y 35 % es justo, menos de 25 % es bajo.',
  },
  punto_equilibrio: {
    group: 'Costos y precios',
    title: 'Punto de equilibrio',
    short: 'Cuánto tenés que vender por mes para no perder plata.',
    long: 'Es el nivel de ventas donde la ganancia de cada botella cubre exactamente los gastos fijos. Por encima, ganás; por debajo, perdés.',
    formula: 'Gastos fijos ÷ margen de contribución %   (o en botellas: gastos fijos ÷ ganancia promedio por botella)',
    example: 'Gastos fijos $900.000 y te quedan $3.000 por botella → necesitás vender 300 botellas por mes.',
    why: 'Te dice el piso de ventas del mes. Es la meta mínima.',
  },
  contribucion: {
    group: 'Costos y precios',
    title: 'Margen de contribución',
    short: 'Lo que te deja cada venta después de los costos variables (vino, comisiones, envíos).',
    formula: 'Ventas − CMV − comisiones − mermas − gastos variables',
    why: 'Es la plata que "contribuye" a pagar los gastos fijos. Con eso se calcula el punto de equilibrio.',
  },
  costo_promedio: {
    group: 'Stock',
    title: 'Costo promedio ponderado',
    short: 'El costo de cada botella, promediando todas tus compras.',
    long: 'Si tenías 10 botellas a $1.000 y comprás 10 a $1.400, ahora tenés 20 a $1.200. Cada venta se valoriza a ese promedio. Es el método más usado por comercios y el aceptado por AFIP/ARCA para valuar mercadería.',
    formula: '(stock × costo anterior + compra × costo nuevo) ÷ (stock + compra)',
    why: 'Con inflación los costos cambian todo el tiempo; el promedio evita que tus números salten.',
  },
  flete_prorrateado: {
    group: 'Stock',
    title: 'Flete repartido en el costo',
    short: 'El envío de una compra se suma al costo de cada botella.',
    long: 'Si pagaste $40.000 de vino y $4.000 de flete, cada botella cuesta 10 % más de lo que dice la factura. El sistema lo reparte solo, proporcional al precio de cada vino.',
    why: 'Así tu costo es el real (lo que te costó tener la botella en el depósito) y los márgenes no te mienten.',
  },
  stock_valorizado: {
    group: 'Stock',
    title: 'Stock valorizado',
    short: 'Cuánta plata tenés "invertida" en botellas, a costo.',
    formula: 'Σ (botellas en stock × costo promedio)',
    why: 'Es plata del negocio que no está en la caja. Mucho stock quieto = plata parada.',
  },
  rotacion: {
    group: 'Stock',
    title: 'Días de stock (cobertura)',
    short: 'Para cuántos días te alcanza lo que tenés, al ritmo de venta actual.',
    formula: 'Stock actual ÷ botellas vendidas por día (últimos 90 días)',
    why: 'Menos de 15 días: reponé. Más de 180: ese vino está parado; pensá en promo o en no recomprarlo.',
  },
  botellas_abiertas: {
    group: 'Stock',
    title: 'Botellas abiertas (de un evento)',
    short: 'Botellas que salieron del stock para un evento sin venderse: para degustar, regalar o sortear.',
    long: 'Se valorizan a lo que te costaron. No es plata nueva que sale de la caja, pero es vino que ya no vas a poder vender: por eso son un costo del evento (y una merma en tus reportes).',
    formula: 'Botellas × costo promedio de cada vino ese día',
  },
  stock_minimo: {
    group: 'Stock',
    title: 'Stock mínimo',
    short: 'Cantidad a partir de la cual el sistema te avisa que hay que reponer.',
    why: 'Evita quedarte sin tus vinos más vendidos.',
  },
  abc: {
    group: 'Stock',
    title: 'Análisis ABC',
    short: 'Ordena tus vinos según cuánto aportan a la ganancia.',
    long: 'A: los pocos vinos que generan el 80 % de la ganancia (cuidalos, que nunca falten). B: el siguiente 15 %. C: el último 5 % (revisá si vale la pena tenerlos).',
    why: 'Te ayuda a decidir qué reponer primero y qué dejar de comprar.',
  },
  caja: {
    group: 'Caja y deudas',
    title: 'Caja (plata disponible)',
    short: 'La plata que tenés hoy sumando efectivo, bancos y billeteras virtuales.',
    formula: 'Saldo inicial + todo lo que entró − todo lo que salió',
    why: 'Con la caja pagás las cuentas. Podés ganar plata y quedarte sin caja (si te deben mucho o compraste mucho stock).',
  },
  devengado_percibido: {
    group: 'Caja y deudas',
    title: 'Resultado vs. caja (¿por qué no coinciden?)',
    short: 'El resultado cuenta lo que vendiste y gastaste; la caja, lo que cobraste y pagaste.',
    long: 'Si vendés a cuenta, el resultado sube hoy pero la caja recién cuando te pagan. Si comprás mucho vino, la caja baja pero el resultado no (es stock). Por eso pueden ser muy distintos, y está bien.',
    why: 'Mirá los dos: el resultado dice si el negocio es bueno; la caja, si podés pagar las cuentas este mes.',
  },
  flujo_caja: {
    group: 'Caja y deudas',
    title: 'Flujo de caja',
    short: 'Lo que entró menos lo que salió de tus cuentas en el período.',
    formula: 'Cobros + otros ingresos − pagos − retiros',
    why: 'Si es negativo varios meses seguidos, la caja se va a vaciar aunque el negocio gane.',
  },
  por_cobrar: {
    group: 'Caja y deudas',
    title: 'Por cobrar',
    short: 'Lo que te deben los clientes (ventas no cobradas o cobradas en parte).',
    why: 'Es plata tuya que todavía no tenés. Cuanto más vieja la deuda, más difícil cobrarla.',
  },
  por_pagar: {
    group: 'Caja y deudas',
    title: 'Por pagar',
    short: 'Lo que le debés a proveedores y gastos todavía no pagados.',
    why: 'Planificá: si lo que tenés que pagar supera la caja más lo que te van a cobrar, se viene un apuro.',
  },
  aportes_retiros: {
    group: 'Caja y deudas',
    title: 'Aportes y retiros',
    short: 'Plata que ponen o sacan los dueños. No es venta ni gasto.',
    why: 'Tus retiros no son un gasto del negocio: es tu ganancia que te llevás. Por eso van aparte.',
  },
  arqueo: {
    group: 'Caja y deudas',
    title: 'Arqueo de caja',
    short: 'Contar la plata real y compararla con lo que dice el sistema.',
    why: 'Si no coincide, cargá un "Ajuste de saldo" y anotá el motivo. Hacerlo seguido evita sorpresas.',
  },
  inflacion: {
    group: 'Impuestos y contexto',
    title: 'Inflación y crecimiento real',
    short: 'Si vendés 5 % más en pesos pero los precios subieron 4 %, creciste solo ~1 %.',
    formula: 'Crecimiento real = (1 + crecimiento en pesos) ÷ (1 + inflación) − 1',
    why: 'En Argentina comparar pesos de meses distintos engaña. Los reportes te muestran los montos "a pesos de hoy".',
  },
  dolar: {
    group: 'Impuestos y contexto',
    title: 'Equivalente en dólares',
    short: 'Montos convertidos a USD con la cotización que cargaste en Configuración.',
    why: 'Sirve de referencia para comparar en el tiempo. El sistema trabaja en pesos; el dólar es solo para mirar.',
  },
  iva: {
    group: 'Impuestos y contexto',
    title: 'IVA',
    short: 'Impuesto al valor agregado (21 % general).',
    long: 'Si sos monotributista, no discriminás IVA: tus precios ya son finales. Si sos responsable inscripto, el IVA que cobrás no es tuyo (lo pagás a ARCA). En este sistema cargamos todo con impuestos incluidos, como sale en el ticket o la factura.',
  },
  iibb: {
    group: 'Impuestos y contexto',
    title: 'Ingresos Brutos (IIBB)',
    short: 'Impuesto provincial sobre lo que vendés (suele ir de 3 % a 5 %).',
    why: 'Se come un pedacito de cada venta. La calculadora de precios lo tiene en cuenta.',
  },
  presupuesto: {
    group: 'Resultados',
    title: 'Metas y presupuesto',
    short: 'Cuánto querés vender y cuánto pensás gastar cada mes.',
    why: 'Sin meta no hay manera de saber si un mes fue bueno o malo. Arrancá con el punto de equilibrio como piso.',
  },
} satisfies Record<string, GlossaryEntry>

export type GlossaryKey = keyof typeof GLOSSARY

export function glossary(key: GlossaryKey): GlossaryEntry {
  return GLOSSARY[key]
}
