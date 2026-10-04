// "Importar desde Excel": cargar o actualizar muchos vinos de una vez con una planilla.
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { CircleCheck, FileSpreadsheet, TriangleAlert, Upload, Info } from 'lucide-react'
import clsx from 'clsx'
import { api } from '@/lib/api'
import { useApiMutation } from '@/lib/queries'
import { Button, ExportButton, Modal } from '@/components/ui'
import type { ImportResult } from './types'

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-mustard/60 text-[14px] font-extrabold text-ink" aria-hidden>
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-extrabold text-ink">{title}</p>
        <div className="mt-1 text-[14px] leading-relaxed text-ink-soft">{children}</div>
      </div>
    </li>
  )
}

export function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setFile(null)
      setResult(null)
      setDragging(false)
      setUploadError(null)
    }
  }, [open])

  const [uploadError, setUploadError] = useState<string | null>(null)
  const upload = useApiMutation((f: File) => api.upload<ImportResult>('/products/import', f), {
    success: (r) => `Importación lista: ${r.created} ${r.created === 1 ? 'vino nuevo' : 'vinos nuevos'} y ${r.updated} ${r.updated === 1 ? 'actualizado' : 'actualizados'}`,
    onSuccess: (r) => setResult(r),
    // El error también queda escrito acá abajo (el aviso de arriba se va solo).
    onError: (err) => setUploadError(err.message || 'No pudimos importar el archivo.'),
  })

  const pick = (f: File | undefined | null) => {
    if (input.current) input.current.value = '' // así se puede volver a elegir el mismo archivo
    if (!f) return
    setFile(f)
    setResult(null)
    setUploadError(null)
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    pick(e.dataTransfer.files?.[0])
  }
  const wrongType = file && !/\.xlsx$/i.test(file.name)

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Importar desde Excel"
      subtitle="Para cargar muchos vinos de una vez, o actualizar todos los precios desde una planilla."
      footer={
        result ? (
          <>
            <Button variant="ghost" onClick={() => (setResult(null), setFile(null), setUploadError(null))}>
              Subir otro archivo
            </Button>
            <Button variant="primary" onClick={onClose}>
              Listo
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button variant="primary" icon={Upload} disabled={!file || !!wrongType} loading={upload.isPending} onClick={() => file && upload.mutate(file)}>
              Importar vinos
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-2xl border border-good/25 bg-good-soft/60 px-4 py-3.5">
            <CircleCheck className="mt-0.5 shrink-0 text-good" size={22} aria-hidden />
            <div className="text-[15px] text-ink">
              <p className="font-extrabold">
                {result.created} {result.created === 1 ? 'vino nuevo' : 'vinos nuevos'} · {result.updated} {result.updated === 1 ? 'actualizado' : 'actualizados'}
              </p>
              <p className="text-[14px] text-ink-soft">
                Leímos {result.total} {result.total === 1 ? 'fila' : 'filas'} del Excel.
                {result.errors.length ? ` ${result.errors.length} no se ${result.errors.length === 1 ? 'pudo' : 'pudieron'} cargar (mirá abajo por qué).` : ' Todo entró bien.'}
              </p>
            </div>
          </div>
          {result.errors.length > 0 && (
            <div className="rounded-2xl border border-bad/25 bg-bad-soft/50 px-4 py-3.5">
              <p className="mb-2 flex items-center gap-2 font-extrabold text-ink">
                <TriangleAlert size={18} className="text-bad" aria-hidden /> Filas que no entraron
              </p>
              <ul className="max-h-[220px] space-y-1.5 overflow-y-auto text-[14px] text-ink-soft">
                {result.errors.map((e, i) => (
                  <li key={i}>
                    <b className="text-ink">Fila {e.row}:</b> {e.message}
                  </li>
                ))}
              </ul>
              <p className="mt-2.5 text-[13px] text-muted">Corregilas en el Excel y volvé a subir el archivo entero: las filas que ya entraron se actualizan, no se duplican.</p>
            </div>
          )}
          {result.notes.length > 0 && (
            <div className="rounded-2xl border border-mustard/50 bg-mustard-soft/60 px-4 py-3.5">
              <p className="mb-2 flex items-center gap-2 font-extrabold text-ink">
                <Info size={18} className="text-mustard-deep" aria-hidden /> Para que sepas
              </p>
              <ul className="max-h-[200px] space-y-1.5 overflow-y-auto text-[14px] text-ink-soft">
                {result.notes.map((e, i) => (
                  <li key={i}>
                    <b className="text-ink">Fila {e.row}:</b> {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <ol className="space-y-5">
          <Step n={1} title="Bajá la plantilla">
            <p>Es un Excel con las columnas que entiende el sistema y una pestaña de instrucciones.</p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <ExportButton path="/products/import-template" label="Plantilla vacía" size="sm" />
              <ExportButton path="/products/import-template" params={{ con_vinos: 1 }} label="Mis vinos, para editar" size="sm" />
            </div>
            <p className="mt-2 text-[13px] text-muted">«Mis vinos, para editar» trae tu catálogo actual: cambiás los precios en Excel y lo volvés a subir.</p>
          </Step>
          <Step n={2} title="Completala en Excel">
            <p>
              Un vino por fila. Solo el <b className="text-ink">Nombre</b> es obligatorio. Los precios se pueden escribir como quieras: 12500, 12.500 o $ 12.500,50.
            </p>
            <p className="mt-1">
              Si el vino <b className="text-ink">ya existe</b> (mismo código SKU o mismo nombre), se actualizan sus datos y precios. Si es <b className="text-ink">nuevo</b>, se crea con su costo y
              stock inicial.
            </p>
          </Step>
          <Step n={3} title="Subila acá">
            <label
              onDragOver={(e) => (e.preventDefault(), setDragging(true))}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={clsx(
                'mt-1 flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition-colors',
                dragging ? 'border-brown bg-mustard-soft' : 'border-line-strong bg-paper hover:border-brown/60',
              )}
            >
              <FileSpreadsheet size={28} className="text-brown" aria-hidden />
              {file ? (
                <span className="text-[14.5px] font-bold break-all text-ink">{file.name}</span>
              ) : (
                <span className="text-[14.5px] font-bold text-ink">Tocá para elegir el archivo, o arrastralo hasta acá</span>
              )}
              <span className="text-[13px] text-muted">{file ? 'Tocá para elegir otro' : 'Archivo de Excel (.xlsx)'}</span>
              <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
            </label>
            {wrongType && <p className="mt-2 text-[13px] font-semibold text-bad">Ese archivo no es un .xlsx. Abrilo en Excel y usá «Guardar como» → «Libro de Excel (.xlsx)».</p>}
            {uploadError && !wrongType && (
              <p role="alert" className="mt-2 flex items-start gap-2 rounded-xl border border-bad/25 bg-bad-soft/50 px-3 py-2 text-[13.5px] text-ink">
                <TriangleAlert size={16} className="mt-0.5 shrink-0 text-bad" aria-hidden />
                <span>
                  <b>No se pudo importar:</b> {uploadError}
                </span>
              </p>
            )}
          </Step>
        </ol>
      )}
    </Modal>
  )
}
