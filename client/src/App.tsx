import { lazy } from 'react'
import { Route, Routes } from 'react-router-dom'
import { AppLayout } from './layout/AppLayout'

// Cada pantalla se carga por separado (así si una falla, las demás siguen andando).
const InicioPage = lazy(() => import('./pages/inicio/InicioPage'))
const MetasPage = lazy(() => import('./pages/metas/MetasPage'))
const CajaPage = lazy(() => import('./pages/caja/CajaPage'))
const ReportesPage = lazy(() => import('./pages/reportes/ReportesPage'))
const VentasPage = lazy(() => import('./pages/ventas/VentasPage'))
const ClientesPage = lazy(() => import('./pages/clientes/ClientesPage'))
const ClienteDetailPage = lazy(() => import('./pages/clientes/ClienteDetailPage'))
const EventosPage = lazy(() => import('./pages/eventos/EventosPage'))
const EventoDetailPage = lazy(() => import('./pages/eventos/EventoDetailPage'))
const ComprasPage = lazy(() => import('./pages/compras/ComprasPage'))
const GastosPage = lazy(() => import('./pages/gastos/GastosPage'))
const ProveedoresPage = lazy(() => import('./pages/proveedores/ProveedoresPage'))
const ProveedorDetailPage = lazy(() => import('./pages/proveedores/ProveedorDetailPage'))
const VinosPage = lazy(() => import('./pages/vinos/VinosPage'))
const VinoDetailPage = lazy(() => import('./pages/vinos/VinoDetailPage'))
const CalculadoraPage = lazy(() => import('./pages/calculadora/CalculadoraPage'))
const AyudaPage = lazy(() => import('./pages/ayuda/AyudaPage'))
const ConfiguracionPage = lazy(() => import('./pages/configuracion/ConfiguracionPage'))
const BienvenidaPage = lazy(() => import('./pages/bienvenida/BienvenidaPage'))
const NotFound = lazy(() => import('./pages/NotFound'))
const KitPage = lazy(() => import('./pages/_kit/KitPage'))

export default function App() {
  return (
    <Routes>
      <Route path="/bienvenida" element={<BienvenidaPage />} />
      <Route element={<AppLayout />}>
        <Route index element={<InicioPage />} />
        <Route path="metas" element={<MetasPage />} />
        <Route path="caja" element={<CajaPage />} />
        <Route path="reportes" element={<ReportesPage />} />
        <Route path="ventas" element={<VentasPage />} />
        <Route path="clientes" element={<ClientesPage />} />
        <Route path="clientes/:id" element={<ClienteDetailPage />} />
        <Route path="eventos" element={<EventosPage />} />
        <Route path="eventos/:id" element={<EventoDetailPage />} />
        <Route path="compras" element={<ComprasPage />} />
        <Route path="gastos" element={<GastosPage />} />
        <Route path="proveedores" element={<ProveedoresPage />} />
        <Route path="proveedores/:id" element={<ProveedorDetailPage />} />
        <Route path="vinos" element={<VinosPage />} />
        <Route path="vinos/:id" element={<VinoDetailPage />} />
        <Route path="calculadora" element={<CalculadoraPage />} />
        <Route path="ayuda" element={<AyudaPage />} />
        <Route path="configuracion" element={<ConfiguracionPage />} />
        <Route path="kit" element={<KitPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
