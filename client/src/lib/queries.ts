// Datos compartidos por varias pantallas + helper para guardar cambios.
// Regla simple: después de guardar cualquier cosa se refresca todo (es un sistema local,
// los datos son pocos y así nunca quedan números viejos en pantalla).
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query'
import type { AccountWithBalance, Client, Product, Settings, Supplier, WineEvent } from '@shared/types'
import { api, type QueryParams } from './api'
import { useToast } from '@/components/ui/Toast'

/** GET genérico con react-query. La key incluye path + params. */
export function useApi<T>(path: string, params?: QueryParams, options?: Omit<UseQueryOptions<T>, 'queryKey' | 'queryFn'>) {
  return useQuery<T>({
    queryKey: [path, params ?? {}],
    queryFn: () => api.get<T>(path, params),
    ...options,
  })
}

export function useSettings() {
  return useApi<Settings>('/settings', undefined, { staleTime: 60_000 })
}

/** Vinos. Por defecto solo los activos. GET /api/products?active=1 */
export function useProducts(opts: { includeInactive?: boolean } = {}) {
  return useApi<Product[]>('/products', opts.includeInactive ? {} : { active: 1 })
}

/** GET /api/clients */
export function useClients() {
  return useApi<Client[]>('/clients')
}

/** GET /api/suppliers */
export function useSuppliers() {
  return useApi<Supplier[]>('/suppliers')
}

/** GET /api/accounts → cuentas con saldo */
export function useAccounts() {
  return useApi<AccountWithBalance[]>('/accounts')
}

/** GET /api/events */
export function useEvents() {
  return useApi<WineEvent[]>('/events')
}

/**
 * Mutación con aviso automático: muestra "✓ mensaje" si sale bien o el error si falla,
 * y refresca todos los datos.
 */
export function useApiMutation<TVars = void, TRes = unknown>(
  fn: (vars: TVars) => Promise<TRes>,
  opts: {
    success?: string | ((res: TRes, vars: TVars) => string) | false
    onSuccess?: (res: TRes, vars: TVars) => void
    onError?: (err: Error) => void
  } = {},
) {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation<TRes, Error, TVars>({
    mutationFn: fn,
    onSuccess: (res, vars) => {
      opts.onSuccess?.(res, vars)
      qc.invalidateQueries()
      if (opts.success !== false && opts.success) {
        toast.success(typeof opts.success === 'function' ? opts.success(res, vars) : opts.success)
      }
    },
    onError: (err) => {
      toast.error(err.message || 'No se pudo guardar.')
      opts.onError?.(err)
    },
  })
}
