import { useState } from 'react'
import { Plus, Store } from 'lucide-react'
import { Badge, Button, Card, ChoiceCards, DataTable, Field, HelpBox, InfoTip, Modal, MoneyInput, PageHeader, PeriodPicker, ProgressBar, Select, StatTile, StatusBadge, Tabs, TextInput, ExportButton, ProductSelect, Money } from '@/components/ui'
import { ChartCard, ColumnChart, DonutChart, Legend, RankBars, ResultChart, TrendChart } from '@/components/charts'
import { CHART_COLORS } from '@shared/constants'
import { money } from '@/lib/format'

const data = ['ene 26', 'feb 26', 'mar 26', 'abr 26', 'may 26', 'jun 26', 'jul 26', 'ago 26', 'sep 26', 'oct 26'].map((label, i) => ({
  label,
  ventas: 1800000 + i * 150000 + (i % 3) * 200000,
  gastos: 1200000 + i * 60000,
  resultado: (i % 4 === 0 ? -1 : 1) * (150000 + i * 30000),
}))

export default function KitPage() {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('a')
  const [v, setV] = useState<number | null>(12500)
  const [c, setC] = useState<'si' | 'no'>('si')
  const [p, setP] = useState<number | null>(null)
  return (
    <>
      <PageHeader title="Kit de diseño" description="Página de prueba de componentes." actions={<><ExportButton path="/health" /><Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>Nueva venta</Button></>} />
      <HelpBox id="kit">
        <p>Esta pantalla sirve para <b>probar</b> los componentes.</p>
        <ul><li>Uno</li><li>Dos</li></ul>
      </HelpBox>
      <div className="mt-5 flex flex-wrap items-center gap-3"><PeriodPicker /><Tabs items={[{ key: 'a', label: 'Resumen', icon: Store }, { key: 'b', label: 'Detalle', count: 12 }]} value={tab} onChange={setTab} /></div>
      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Ventas" value={money(2450000)} term="ventas" delta={0.12} tone="sky" hint="152 ventas · 410 botellas" hero />
        <StatTile label="Gastos" value={money(980000)} term="gastos" delta={0.08} upIsGood={false} tone="coral" />
        <StatTile label="Margen bruto" value="38,5 %" term="margen_bruto" delta={-0.02} />
        <StatTile label="Resultado" value={<Money value={-120000} tone="auto" />} term="resultado" delta={null} hint="Perdiste plata este mes" />
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <ChartCard title="Ventas vs. gastos" subtitle="Últimos 10 meses" term="resultado" legend={<Legend items={[{ label: 'Ventas', color: CHART_COLORS.ventas }, { label: 'Gastos', color: CHART_COLORS.gastos }]} />} table={{ columns: [{ key: 'label', header: 'Mes' }, { key: 'ventas', header: 'Ventas', align: 'right', format: (x) => money(Number(x)) }], rows: data }}>
          <ColumnChart data={data} series={[{ key: 'ventas', label: 'Ventas', color: CHART_COLORS.ventas }, { key: 'gastos', label: 'Gastos', color: CHART_COLORS.gastos }]} />
        </ChartCard>
        <ChartCard title="Resultado por mes"><ResultChart data={data} valueKey="resultado" /></ChartCard>
        <ChartCard title="Evolución"><TrendChart data={data} area series={[{ key: 'ventas', label: 'Ventas', color: CHART_COLORS.ventas }]} /></ChartCard>
        <ChartCard title="Por canal"><DonutChart data={[{ label: 'Local', value: 900000 }, { label: 'Online', value: 500000 }, { label: 'Mayorista', value: 700000 }, { label: 'Eventos', value: 200000 }]} /></ChartCard>
        <Card title="Top vinos"><RankBars items={[{ label: 'Malbec Reserva', value: 450000, sublabel: 'Catena' }, { label: 'Torrontés', value: 220000 }, { label: 'Blend', value: 120000 }]} /></Card>
        <Card title="Formulario" subtitle="Campos">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre" required hint="Así lo vas a ver en las listas"><TextInput placeholder="Malbec…" /></Field>
            <Field label="Precio" info="markup"><MoneyInput value={v} onChange={setV} /></Field>
            <Field label="Canal"><Select value="local" onChange={() => {}} options={[{ value: 'local', label: 'Local' }]} /></Field>
            <Field label="Vino"><ProductSelect value={p} onChange={(id) => setP(id)} /></Field>
          </div>
          <ChoiceCards className="mt-4" value={c} onChange={setC} options={[{ value: 'si', title: 'Sí, ya la cobré', description: 'Entra la plata a la cuenta' }, { value: 'no', title: 'Todavía no', description: 'Queda como "por cobrar"' }]} />
          <div className="mt-4"><ProgressBar value={720000} max={1000000} /></div>
          <div className="mt-4 flex gap-2"><StatusBadge status="pagado" kind="sale" /><StatusBadge status="pendiente" /><StatusBadge status="parcial" overdue /><Badge tone="sky">Online</Badge> <InfoTip term="cmv" /></div>
        </Card>
      </div>
      <Card className="mt-5" title="Tabla" flush>
        <div className="px-5 pb-5">
          <DataTable rows={data} rowKey={(r) => r.label} columns={[{ key: 'label', header: 'Mes' }, { key: 'ventas', header: 'Ventas', align: 'right', cell: (r) => money(r.ventas), footer: money(123) }, { key: 'gastos', header: 'Gastos', align: 'right', cell: (r) => money(r.gastos), hideBelow: 'sm' }]} onRowClick={() => setOpen(true)} />
        </div>
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title="Nueva venta" subtitle="Cargá lo que vendiste" size="lg" footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button><Button variant="primary">Guardar venta</Button></>}>
        <Field label="Vino"><ProductSelect value={p} onChange={(id) => setP(id)} /></Field>
      </Modal>
    </>
  )
}
