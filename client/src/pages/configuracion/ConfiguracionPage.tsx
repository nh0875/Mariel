// Configuración: los datos del negocio y todo lo que hace que los números sean "los tuyos"
// (comisiones, categorías, márgenes, dólar), más copias de seguridad y acciones sobre todos los datos.
// Cada sección se guarda por separado (PUT /settings solo con sus claves).
import { Boxes, CreditCard, Database, DatabaseBackup, DollarSign, Landmark, Percent, Store, Tags } from 'lucide-react'
import type { BackupRow } from './types'
import { api } from '@/lib/api'
import { bytes, SectionIndex, useDirtyRegistry, useHashScroll, type IndexItem } from './parts'
import { useApiMutation, useSettings } from '@/lib/queries'
import { useLeaveGuard } from '@/lib/leaveGuard'
import { Button, ErrorState, ExportButton, HelpBox, Loading, PageHeader } from '@/components/ui'
import { AccountsSection, BusinessSection, CategoriesSection, PaymentMethodsSection, PricingSection, StockDefaultsSection, UsdSection } from './sections'
import { BackupsSection, DataSection } from './data'

const INDEX: IndexItem[] = [
  { id: 'negocio', label: 'Tu negocio', icon: Store },
  { id: 'medios-de-pago', label: 'Medios de pago', icon: CreditCard },
  { id: 'cuentas', label: 'Cuentas', icon: Landmark },
  { id: 'categorias', label: 'Categorías de gastos', icon: Tags },
  { id: 'precios', label: 'Precios y márgenes', icon: Percent },
  { id: 'dolar', label: 'Dólar', icon: DollarSign },
  { id: 'stock', label: 'Stock', icon: Boxes },
  { id: 'backups', label: 'Copias de seguridad', icon: DatabaseBackup },
  { id: 'datos', label: 'Tus datos', icon: Database },
]

export default function ConfiguracionPage() {
  const settings = useSettings()
  const { dirty, onDirty, any } = useDirtyRegistry()
  // Cambios sin guardar: si tocás otra opción del menú, preguntamos antes de salir (no se pierden en silencio).
  const pending = INDEX.filter((i) => dirty[i.id]).map((i) => `«${i.label}»`)
  useLeaveGuard(any, {
    title: '¿Salís sin guardar?',
    message: `Tenés cambios sin guardar en ${pending.length > 1 ? `${pending.slice(0, -1).join(', ')} y ${pending[pending.length - 1]}` : (pending[0] ?? 'esta pantalla')}. Si salís ahora, se pierden. Para no perderlos, quedate y tocá «Guardar» en cada sección.`,
    confirmText: 'Salir sin guardar',
    cancelText: 'Quedarme y guardar',
  })
  useHashScroll(!!settings.data)
  const backup = useApiMutation(() => api.post<BackupRow>('/backups'), { success: (b) => `Listo, copia guardada (${bytes(b.size)}). La ves en «Copias de seguridad».` })

  const s = settings.data
  return (
    <>
      <PageHeader
        title="Configuración"
        description="Los datos de tu negocio, cómo cobrás, tus categorías de gastos, tus copias de seguridad… todo lo que hace que los números del sistema sean los tuyos."
        actions={
          <>
            <ExportButton path="/export/all" label="Descargar todo en Excel" />
            <Button variant="primary" icon={DatabaseBackup} onClick={() => backup.mutate()} loading={backup.isPending}>
              Hacer una copia ahora
            </Button>
          </>
        }
      />
      <HelpBox id="config">
        <p>
          Acá le contás al sistema <b>cómo es tu negocio</b>, para que todas las cuentas usen tus números reales. Cada sección tiene su propio botón <b>Guardar</b>: cambiás algo, guardás y listo.
        </p>
        <p>
          <b>Ejemplo:</b> si Mercado Pago te cobra 6,29 % y lo cargás en «Medios de pago», cada venta de $ 20.000 por QR descuenta sola $ 1.258 de comisión. Sin eso, el sistema creería que ganaste $ 1.258
          más de lo que ganaste.
        </p>
        <ul>
          <li>
            <b>Lo más importante al empezar:</b> los datos del negocio, las comisiones de cada medio de pago y en qué cuenta entra la plata.
          </li>
          <li>
            <b>Tus datos están seguros:</b> todos los días se guarda una copia automática, y antes de borrar o restaurar algo también.
          </li>
        </ul>
        <p>
          <b>¿Por qué importa?</b> Un sistema con comisiones o márgenes mal cargados te muestra ganancias que no existen. Diez minutos acá hacen que todo lo demás sea confiable.
        </p>
      </HelpBox>

      <div className="mt-6 xl:grid xl:grid-cols-[210px_minmax(0,1fr)] xl:gap-8">
        <SectionIndex items={INDEX.map((i) => ({ ...i, dirty: dirty[i.id] }))} />
        <div className="min-w-0 space-y-6">
          {settings.isLoading ? (
            <Loading label="Cargando la configuración…" />
          ) : settings.error || !s ? (
            <ErrorState error={settings.error ?? 'No pudimos leer la configuración.'} onRetry={() => settings.refetch()} />
          ) : (
            <>
              <BusinessSection settings={s} onDirty={onDirty} />
              <PaymentMethodsSection settings={s} onDirty={onDirty} />
              <AccountsSection settings={s} />
              <CategoriesSection settings={s} onDirty={onDirty} />
              <PricingSection settings={s} onDirty={onDirty} />
              <UsdSection settings={s} onDirty={onDirty} />
              <StockDefaultsSection settings={s} onDirty={onDirty} />
              <BackupsSection />
              <DataSection />
            </>
          )}
        </div>
      </div>
    </>
  )
}
