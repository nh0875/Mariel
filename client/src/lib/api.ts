// Cliente de la API. Todas las pantallas hablan con el servidor a través de esto.
// Los errores vienen ya con un mensaje en castellano listo para mostrar.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message)
  }
}

export type QueryParams = Record<string, string | number | boolean | null | undefined>

function toQuery(params?: QueryParams): string {
  if (!params) return ''
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    sp.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

/** URL completa de la API (útil para descargas). */
export function apiUrl(path: string, params?: QueryParams): string {
  return `/api${path.startsWith('/') ? path : `/${path}`}${toQuery(params)}`
}

async function request<T>(method: string, path: string, body?: unknown, params?: QueryParams): Promise<T> {
  let res: Response
  try {
    res = await fetch(apiUrl(path, params), {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'No hay conexión con el sistema. ¿Está abierta la ventana negra del programa? Si la cerraste, volvé a abrir VINOH!.')
  }
  const text = await res.text()
  let data: unknown = undefined
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  if (!res.ok) {
    const msg =
      data && typeof data === 'object' && 'error' in data ? String((data as { error: unknown }).error) : `Error ${res.status}`
    throw new ApiError(res.status, msg, (data as { details?: unknown })?.details)
  }
  return data as T
}

export const api = {
  get: <T>(path: string, params?: QueryParams) => request<T>('GET', path, undefined, params),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  del: <T>(path: string) => request<T>('DELETE', path),
  /** Sube un archivo crudo (Excel, backup). El servidor lo recibe como body binario. */
  upload: async <T>(path: string, file: File | Blob, params?: QueryParams): Promise<T> => {
    const res = await fetch(apiUrl(path, params), {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new ApiError(res.status, data?.error || `Error ${res.status}`, data?.details)
    return data as T
  },
}

/** Descarga un archivo (ej: Excel) desde la API sin salir de la página. */
export async function downloadFile(path: string, params?: QueryParams): Promise<void> {
  const res = await fetch(apiUrl(path, params))
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new ApiError(res.status, data?.error || 'No se pudo generar el archivo.')
  }
  const blob = await res.blob()
  const cd = res.headers.get('Content-Disposition') || ''
  const match = /filename\*=UTF-8''([^;]+)/.exec(cd) || /filename="?([^";]+)"?/.exec(cd)
  const name = match ? decodeURIComponent(match[1]) : 'vinoh-export.xlsx'
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
