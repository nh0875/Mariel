// Menú del sistema. Los grupos están armados según "para dónde va la plata",
// y cada grupo tiene un color de la marca que se repite en los títulos de sus pantallas.
import type { LucideIcon } from 'lucide-react'
import {
  BookOpen,
  Calculator,
  CalendarHeart,
  ChartColumn,
  House,
  Landmark,
  Receipt,
  Settings,
  ShoppingBasket,
  Store,
  Target,
  Truck,
  Users,
  Wine,
} from 'lucide-react'

export type Tone = 'orange' | 'sky' | 'coral' | 'mustard' | 'brown'

export const TONE_VAR: Record<Tone, string> = {
  orange: 'var(--color-orange)',
  sky: 'var(--color-sky)',
  coral: 'var(--color-coral)',
  mustard: 'var(--color-mustard)',
  brown: 'var(--color-brown)',
}
export const TONE_SOFT: Record<Tone, string> = {
  orange: 'var(--color-orange-soft)',
  sky: 'var(--color-sky-soft)',
  coral: 'var(--color-coral-soft)',
  mustard: 'var(--color-mustard-soft)',
  brown: 'var(--color-cream-deep)',
}
export const TONE_DEEP: Record<Tone, string> = {
  orange: 'var(--color-orange-deep)',
  sky: 'var(--color-sky-deep)',
  coral: 'var(--color-coral-deep)',
  mustard: 'var(--color-mustard-deep)',
  brown: 'var(--color-brown)',
}

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Frase corta que aparece al pasar el mouse. */
  hint: string
}

export interface NavGroup {
  id: string
  label: string
  tone: Tone
  items: NavItem[]
}

export const NAV: NavGroup[] = [
  {
    id: 'como-venimos',
    label: 'Cómo venimos',
    tone: 'orange',
    items: [
      { to: '/', label: 'Inicio', icon: House, hint: 'El resumen del negocio de un vistazo' },
      { to: '/caja', label: 'Caja y bancos', icon: Landmark, hint: 'Cuánta plata hay y dónde' },
      { to: '/reportes', label: 'Reportes', icon: ChartColumn, hint: 'Ganancias, rentabilidad por vino, gastos…' },
      { to: '/metas', label: 'Metas', icon: Target, hint: 'Objetivos de venta y presupuesto' },
    ],
  },
  {
    id: 'entra-plata',
    label: 'Entra plata',
    tone: 'sky',
    items: [
      { to: '/ventas', label: 'Ventas', icon: Store, hint: 'Cargá y mirá tus ventas' },
      { to: '/clientes', label: 'Clientes', icon: Users, hint: 'Quién te compra y quién te debe' },
      { to: '/eventos', label: 'Eventos', icon: CalendarHeart, hint: 'Degustaciones, ferias y catas' },
    ],
  },
  {
    id: 'sale-plata',
    label: 'Sale plata',
    tone: 'coral',
    items: [
      { to: '/compras', label: 'Compras de vino', icon: ShoppingBasket, hint: 'Lo que le comprás a bodegas' },
      { to: '/gastos', label: 'Gastos', icon: Receipt, hint: 'Alquiler, sueldos, envíos…' },
      { to: '/proveedores', label: 'Proveedores', icon: Truck, hint: 'Bodegas y servicios' },
    ],
  },
  {
    id: 'los-vinos',
    label: 'Los vinos',
    tone: 'mustard',
    items: [{ to: '/vinos', label: 'Vinos y stock', icon: Wine, hint: 'Tu catálogo, precios y botellas' }],
  },
  {
    id: 'herramientas',
    label: 'Herramientas',
    tone: 'brown',
    items: [
      { to: '/calculadora', label: 'Calculadora', icon: Calculator, hint: '¿A cuánto lo vendo? ¿Cuánto tengo que vender?' },
      { to: '/ayuda', label: 'Ayuda', icon: BookOpen, hint: 'Cómo se usa y qué significa cada número' },
      { to: '/configuracion', label: 'Configuración', icon: Settings, hint: 'Datos del negocio, cuentas, copias de seguridad' },
    ],
  },
]

/** Color del grupo al que pertenece una ruta (para el título de la página). */
export function toneForPath(path: string): Tone {
  const clean = '/' + (path.split('/')[1] ?? '')
  for (const g of NAV) if (g.items.some((i) => i.to === clean)) return g.tone
  return 'mustard'
}

export function groupForPath(path: string): NavGroup | undefined {
  const clean = '/' + (path.split('/')[1] ?? '')
  return NAV.find((g) => g.items.some((i) => i.to === clean))
}
