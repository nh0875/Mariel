import { useState } from 'react'
import { FileSpreadsheet } from 'lucide-react'
import { downloadFile, type QueryParams } from '@/lib/api'
import { Button, type ButtonProps } from './Button'
import { useToast } from './Toast'

/**
 * "Descargar Excel": pide el archivo a la API y lo baja. path es relativo a /api (ej: "/sales/export").
 */
export function ExportButton({ path, params, label = 'Descargar Excel', ...rest }: { path: string; params?: QueryParams; label?: string } & Omit<ButtonProps, 'onClick'>) {
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  return (
    <Button
      icon={FileSpreadsheet}
      loading={busy}
      onClick={async () => {
        setBusy(true)
        try {
          await downloadFile(path, params)
          toast.success('Listo, el Excel se descargó (fijate en tu carpeta de Descargas).')
        } catch (e) {
          toast.error((e as Error).message)
        } finally {
          setBusy(false)
        }
      }}
      {...rest}
    >
      {label}
    </Button>
  )
}
