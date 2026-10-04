// Secciones de Configuración que no se "guardan": copias de seguridad y acciones sobre todos los datos
// (Excel completo, datos de ejemplo, borrar todo) + información del sistema.
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ClipboardCopy, Database, DatabaseBackup, Download, FileSpreadsheet, FlaskConical, FolderOpen, HardDrive, History, RotateCcw, ShieldCheck, Trash2, Upload } from 'lucide-react'
import type { Settings } from '@shared/types'
import { api, downloadFile } from '@/lib/api'
import { int } from '@/lib/format'
import { useApi, useApiMutation } from '@/lib/queries'
import { Badge, Button, DataTable, EmptyState, ErrorState, ExportButton, Field, InfoTip, Loading, Modal, TextInput, useConfirm, useToast, type Column } from '@/components/ui'
import { SectionCard, bytes, dateTime, timeAgo } from './parts'
import type { BackupRow, BackupsResponse, SystemInfo } from './types'

/** Ruta de carpeta con botón "Copiar" (para encontrarla en el explorador de archivos). */
function PathBox({ label, value }: { label: string; value: string }) {
  const toast = useToast()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success('Copiado. Pegalo en el explorador de archivos para abrir la carpeta.')
    } catch {
      toast.info('No pudimos copiarlo solo: seleccioná el texto y copialo a mano.')
    }
  }
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[13px] font-bold text-ink-soft">{label}</p>
      <div className="flex items-start gap-2 rounded-xl border border-line bg-cream/60 px-3 py-2">
        <FolderOpen size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />
        <code className="min-w-0 flex-1 font-mono text-[12.5px] leading-snug break-all text-ink select-all">{value}</code>
        <button type="button" onClick={copy} className="shrink-0 rounded-full p-1 text-ink-soft hover:bg-cream-deep hover:text-ink" aria-label={`Copiar ${label}`} title="Copiar">
          <ClipboardCopy size={16} />
        </button>
      </div>
    </div>
  )
}

const KIND_TONE: Record<string, 'good' | 'sky' | 'warn' | 'neutral'> = {
  auto: 'good',
  manual: 'sky',
  'antes-de-restaurar': 'warn',
  'antes-de-borrar': 'warn',
  'antes-de-ejemplo': 'warn',
  'antes-de-demo': 'warn',
}

// ───────────────────────── Copias de seguridad ─────────────────────────

export function BackupsSection() {
  const q = useApi<BackupsResponse>('/backups')
  const confirm = useConfirm()
  const toast = useToast()
  const fileInput = useRef<HTMLInputElement>(null)
  const make = useApiMutation(() => api.post<BackupRow>('/backups'), { success: (b) => `Listo, copia guardada (${bytes(b.size)}).` })
  const reload = () => window.setTimeout(() => window.location.reload(), 1200)
  const restore = useApiMutation((file: string) => api.post(`/backups/${encodeURIComponent(file)}/restore`), {
    success: 'Listo, volvimos a esa copia. Recargamos la página para mostrarte los datos…',
    onSuccess: reload,
  })
  const upload = useApiMutation((file: File) => api.upload('/backups/restore-upload', file), {
    success: 'Listo, restauramos el archivo. Recargamos la página para mostrarte los datos…',
    onSuccess: reload,
  })
  const busy = restore.isPending || upload.isPending

  const askRestore = async (b: BackupRow) => {
    const ok = await confirm({
      title: '¿Volver a esta copia?',
      danger: true,
      confirmText: 'Sí, volver a esta copia',
      message: (
        <div className="space-y-2">
          <p>
            Tus datos van a quedar <b>exactamente como estaban el {dateTime(b.created_at)}</b>. Todo lo que cargaste después (ventas, gastos, cambios) se reemplaza.
          </p>
          <p>
            <b>Tranqui:</b> antes de restaurar guardamos una copia de cómo está todo ahora (aparece como «Antes de restaurar otra copia»), así podés volver si te arrepentís.
          </p>
          <p>Al terminar, la página se recarga sola.</p>
        </div>
      ),
    })
    if (ok) restore.mutate(b.file)
  }

  const onPickFile = async (file: File | undefined) => {
    if (fileInput.current) fileInput.current.value = ''
    if (!file) return
    if (!/\.db$/i.test(file.name)) {
      toast.error('Ese archivo no es una copia de VINOH!. Elegí un archivo que termine en .db (por ejemplo, vinoh-manual-2026-01-31-….db).')
      return
    }
    const ok = await confirm({
      title: '¿Restaurar desde este archivo?',
      danger: true,
      confirmText: 'Sí, restaurar',
      message: (
        <div className="space-y-2">
          <p>
            Vas a reemplazar <b>todos tus datos actuales</b> por los del archivo <b className="break-all">«{file.name}»</b> ({bytes(file.size)}).
          </p>
          <p>Antes guardamos una copia de cómo está todo ahora, por si te arrepentís. Al terminar, la página se recarga.</p>
        </div>
      ),
    })
    if (ok) upload.mutate(file)
  }

  const data = q.data
  const columns: Column<BackupRow>[] = [
    {
      key: 'created_at',
      header: 'Cuándo',
      value: (b) => b.created_at,
      cell: (b) => (
        <div className="min-w-0">
          <p className="vh-num font-bold whitespace-nowrap text-ink">{dateTime(b.created_at)}</p>
          <p className="text-[12.5px] text-muted">{timeAgo(b.created_at)}</p>
        </div>
      ),
    },
    { key: 'label', header: 'Tipo', cell: (b) => <Badge tone={KIND_TONE[b.kind] ?? 'neutral'}>{b.label}</Badge>, hideBelow: 'sm' },
    { key: 'size', header: 'Tamaño', align: 'right', cell: (b) => bytes(b.size), hideBelow: 'md' },
    {
      key: 'actions',
      header: '',
      sortable: false,
      align: 'right',
      cell: (b) => (
        <div className="flex justify-end gap-1.5">
          <Button
            size="sm"
            icon={Download}
            title="Bajar este archivo (para guardarlo en un pendrive o llevarlo a otra compu)"
            onClick={() => downloadFile(`/backups/${encodeURIComponent(b.file)}/download`).catch((e) => toast.error((e as Error).message))}
          >
            <span className="hidden sm:inline">Descargar</span>
          </Button>
          <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => askRestore(b)} disabled={busy}>
            Restaurar
          </Button>
        </div>
      ),
    },
  ]

  return (
    <SectionCard
      id="backups"
      icon={DatabaseBackup}
      title="Copias de seguridad"
      why={
        <>
          Tus datos viven en un archivo en esta computadora. Por si se borra, se rompe o te equivocás, <b>todos los días la primera vez que abrís el programa se guarda una copia completa automática</b>{' '}
          (se guardan las últimas {data?.keep ?? 30}). También se hace una copia antes de borrar todo, cargar el ejemplo o restaurar. Para tener una copia fuera de la compu, descargala y guardala en un
          pendrive o en tu mail.
        </>
      }
      extraActions={
        data?.available ? (
          <>
            <Button size="sm" icon={Upload} onClick={() => fileInput.current?.click()} loading={upload.isPending}>
              Restaurar desde un archivo
            </Button>
            <Button size="sm" icon={DatabaseBackup} onClick={() => make.mutate()} loading={make.isPending}>
              Hacer una copia ahora
            </Button>
          </>
        ) : null
      }
    >
      <input ref={fileInput} type="file" accept=".db,application/octet-stream,application/x-sqlite3" className="hidden" onChange={(e) => onPickFile(e.target.files?.[0])} aria-hidden tabIndex={-1} />
      {q.isLoading ? (
        <Loading label="Buscando tus copias…" />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !data?.available ? (
        <EmptyState icon={HardDrive} title="Sin copias en este modo" compact>
          {data?.message ?? 'Este sistema no está guardando en disco.'}
        </EmptyState>
      ) : (
        <>
          <div className="mb-4 grid gap-3 md:grid-cols-[auto_minmax(0,1fr)] md:items-end">
            <div className="flex flex-wrap gap-2">
              <div className="rounded-xl border border-line px-3.5 py-2">
                <p className="text-[12.5px] font-bold text-ink-soft">Última copia</p>
                <p className="font-extrabold text-ink">{data.backups[0] ? timeAgo(data.backups[0].created_at) : 'Ninguna todavía'}</p>
              </div>
              <div className="rounded-xl border border-line px-3.5 py-2">
                <p className="text-[12.5px] font-bold text-ink-soft">Copias guardadas</p>
                <p className="font-extrabold text-ink">
                  {int(data.backups.length)} <span className="text-[13px] font-semibold text-muted">de {data.keep} como máximo</span>
                </p>
              </div>
            </div>
            <PathBox label="Están en esta carpeta" value={data.backup_dir} />
          </div>
          <DataTable
            rows={data.backups}
            columns={columns}
            rowKey={(b) => b.file}
            searchable={false}
            pageSize={6}
            dense
            empty={
              <EmptyState
                icon={ShieldCheck}
                title="Todavía no hay copias"
                compact
                action={
                  <Button icon={DatabaseBackup} onClick={() => make.mutate()} loading={make.isPending}>
                    Hacer la primera copia
                  </Button>
                }
              >
                La primera copia automática se hace la próxima vez que abras el programa. Si querés, hacé una ahora.
              </EmptyState>
            }
          />
          <p className="mt-3 text-[13px] text-muted">
            <b className="text-ink-soft">¿Cuándo restaurar?</b> Si borraste algo por error o los datos quedaron mal, elegí la copia de antes del problema y tocá «Restaurar». Para pasar el sistema a otra
            computadora, descargá una copia acá y en la otra compu usá «Restaurar desde un archivo».
          </p>
        </>
      )}
    </SectionCard>
  )
}

// ───────────────────────── Tus datos ─────────────────────────

function ActionRow({ icon: Icon, title, children, action, tone = 'neutral' }: { icon: typeof Database; title: string; children: React.ReactNode; action: React.ReactNode; tone?: 'neutral' | 'danger' }) {
  return (
    <div className={`flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center ${tone === 'danger' ? 'border-bad/30 bg-bad-soft/40' : 'border-line bg-paper'}`}>
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tone === 'danger' ? 'bg-bad-soft text-bad' : 'bg-cream-deep text-brown'}`} aria-hidden>
        <Icon size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-extrabold text-ink">{title}</p>
        <div className="text-[14px] leading-snug text-ink-soft [&_b]:text-ink">{children}</div>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  )
}

function ResetModal({ open, onClose, onConfirm, loading }: { open: boolean; onClose: () => void; onConfirm: () => void; loading: boolean }) {
  const [text, setText] = useState('')
  const ok = text.trim().toUpperCase() === 'BORRAR'
  const close = () => {
    setText('')
    onClose()
  }
  return (
    <Modal
      open={open}
      onClose={close}
      title="Borrar todo y empezar de cero"
      subtitle="Esto no se puede deshacer desde acá (salvo restaurando una copia)."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <Button variant="danger" icon={Trash2} disabled={!ok} loading={loading} onClick={onConfirm}>
            Borrar todo
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (ok && !loading) onConfirm()
        }}
        className="space-y-3 text-[14.5px] text-ink-soft [&_b]:text-ink"
      >
        <p>
          <b>Se borran:</b> vinos y stock, ventas, compras, gastos (y gastos fijos), movimientos de caja, clientes, proveedores, eventos, metas e inflación.
        </p>
        <p>
          <b>Se mantiene:</b> la configuración (nombre del negocio, medios de pago, categorías, precios). Las cuentas vuelven a ser Caja, Banco y Mercado Pago en $ 0.
        </p>
        <p>
          Antes de borrar guardamos una <b>copia de seguridad</b> («Antes de borrar todo»). Después te llevamos a la bienvenida para cargar tus saldos iniciales.
        </p>
        <Field htmlFor="cfg-borrar" label="Para confirmar, escribí BORRAR" hint="En mayúsculas o minúsculas, da igual.">
          <TextInput id="cfg-borrar" value={text} onChange={(e) => setText(e.target.value)} placeholder="BORRAR" autoComplete="off" aria-label="Escribí BORRAR para confirmar" data-autofocus />
        </Field>
      </form>
    </Modal>
  )
}

export function DataSection() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const toast = useToast()
  const [resetOpen, setResetOpen] = useState(false)
  const sys = useApi<SystemInfo>('/system')

  const demo = useApiMutation(
    async () => {
      const r = await api.post<{ sales: number; purchases: number; expenses: number }>('/demo/load')
      qc.setQueryData(['/settings', {}], await api.get<Settings>('/settings'))
      return r
    },
    {
      success: (r) => `Listo: cargamos ${int(r.sales)} ventas, ${int(r.purchases)} compras y ${int(r.expenses)} gastos de ejemplo.`,
      onSuccess: () => navigate('/'),
    },
  )
  const reset = useApiMutation(
    async () => {
      await api.post('/data/reset', { restart_onboarding: true })
      qc.setQueryData(['/settings', {}], await api.get<Settings>('/settings'))
    },
    {
      success: 'Listo, borramos todo. Arranquemos de nuevo.',
      onSuccess: () => {
        setResetOpen(false)
        navigate('/bienvenida')
      },
    },
  )

  const askDemo = async () => {
    const ok = await confirm({
      title: '¿Cargar los datos de ejemplo?',
      danger: true,
      confirmText: 'Sí, cargar el ejemplo',
      message: (
        <div className="space-y-2">
          <p>
            <b>Se reemplaza TODO lo que tenés cargado</b> por 14 meses de una vinoteca inventada (vinos, ventas, compras, gastos, clientes…).
          </p>
          <p>Antes guardamos una copia de seguridad, así si te arrepentís la restaurás. Tarda unos segundos.</p>
        </div>
      ),
    })
    if (ok) {
      toast.info('Preparando los datos de ejemplo… tarda unos segundos.')
      demo.mutate()
    }
  }

  const s = sys.data
  return (
    <SectionCard
      id="datos"
      icon={Database}
      title="Tus datos"
      why={
        <>
          Sacá todo a Excel cuando quieras, probá el sistema con datos de ejemplo o empezá de cero. <b>Antes de reemplazar o borrar algo, siempre se guarda una copia de seguridad.</b>
        </>
      }
    >
      <div className="space-y-3">
        <ActionRow icon={FileSpreadsheet} title="Descargar TODO en Excel" action={<ExportButton path="/export/all" label="Descargar todo en Excel" />}>
          Un archivo con 16 hojas (vinos, ventas con su detalle, compras, gastos, caja, clientes, proveedores, eventos, metas…) y una hoja «Léeme» que explica cada una. Ideal para el contador o para
          tener tus datos en un formato que se abre en cualquier compu.
        </ActionRow>
        <ActionRow icon={FlaskConical} title="Cargar datos de ejemplo" action={<Button icon={FlaskConical} onClick={askDemo} loading={demo.isPending}>{demo.isPending ? 'Cargando ejemplo…' : 'Cargar datos de ejemplo'}</Button>}>
          Reemplaza todo por 14 meses de una vinoteca inventada, para que pruebes sin miedo y veas cómo se ven los reportes con datos.
        </ActionRow>
        <ActionRow
          icon={Trash2}
          tone="danger"
          title="Borrar todo y empezar de cero"
          action={
            <Button variant="danger" icon={Trash2} onClick={() => setResetOpen(true)}>
              Borrar todo
            </Button>
          }
        >
          Borra vinos, ventas, compras, gastos, caja y contactos. <b>Tu configuración se mantiene.</b> Úsalo para sacar los datos de ejemplo y arrancar con los tuyos.
        </ActionRow>
      </div>

      <div className="mt-6 border-t border-line pt-5">
        <div className="mb-3 flex items-center gap-1.5">
          <History size={17} className="text-brown" aria-hidden />
          <h3 className="font-extrabold text-ink">Información del sistema</h3>
          <InfoTip title="¿Para qué sirve esto?" text="Si alguna vez necesitás ayuda técnica, estos datos le dicen a quien te ayude qué versión tenés y dónde están tus archivos." />
        </div>
        {sys.isLoading ? (
          <Loading label="Leyendo…" />
        ) : sys.error ? (
          <ErrorState error={sys.error} onRetry={() => sys.refetch()} />
        ) : s ? (
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-3">
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[14px]">
                <dt className="font-bold text-ink-soft">Versión</dt>
                <dd className="text-ink">VINOH! Finanzas {s.version}</dd>
                <dt className="font-bold text-ink-soft">Node.js</dt>
                <dd className="text-ink">{s.node}</dd>
                <dt className="font-bold text-ink-soft">Tamaño de los datos</dt>
                <dd className="text-ink">{s.in_memory ? 'En memoria (modo de prueba)' : bytes(s.db_size)}</dd>
                <dt className="font-bold text-ink-soft">Última copia</dt>
                <dd className="text-ink">{s.last_backup ? `${dateTime(s.last_backup.created_at)} (${timeAgo(s.last_backup.created_at)})` : 'Ninguna todavía'}</dd>
              </dl>
              {!s.in_memory && <PathBox label="Archivo de datos" value={s.db_path} />}
            </div>
            <div>
              <p className="mb-2 text-[13px] font-bold text-ink-soft">Lo que tenés cargado</p>
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {s.counts
                  .filter((c) => !['sale_items', 'purchase_items'].includes(c.table))
                  .map((c) => (
                    <li key={c.table} className="rounded-xl bg-cream-deep/70 px-3 py-2">
                      <p className="vh-num text-[17px] leading-tight font-extrabold text-ink">{int(c.count)}</p>
                      <p className="text-[12.5px] leading-tight text-ink-soft">{c.label}</p>
                    </li>
                  ))}
              </ul>
            </div>
          </div>
        ) : null}
      </div>

      <ResetModal open={resetOpen} onClose={() => setResetOpen(false)} onConfirm={() => reset.mutate()} loading={reset.isPending} />
    </SectionCard>
  )
}
