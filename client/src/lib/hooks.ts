import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Abre el formulario "nuevo" cuando la URL tiene ?nuevo=1 (así funcionan los botones
 * rápidos de arriba: "+ Venta", "+ Gasto", "+ Compra").
 * Devuelve [abierto, abrir, cerrar].
 */
export function useNewParam(): [boolean, () => void, () => void] {
  const [params, setParams] = useSearchParams()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (params.get('nuevo') === '1') {
      setOpen(true)
      const next = new URLSearchParams(params)
      next.delete('nuevo')
      setParams(next, { replace: true })
    }
  }, [params, setParams])
  return [open, useCallback(() => setOpen(true), []), useCallback(() => setOpen(false), [])]
}

/** Valor "demorado" (para buscadores que consultan al servidor). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return v
}

/** Estado que se recuerda en el navegador (ej: la pestaña elegida). Si no hay localStorage, funciona igual sin recordar. */
export function useLocalState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`vinoh.${key}`)
      if (raw == null) return initial
      const parsed = JSON.parse(raw) as unknown
      // Si lo guardado está roto o es de otro tipo (ej. "null" donde va un texto), arrancamos de cero.
      if (parsed == null && initial != null) return initial
      if (initial != null && parsed != null && typeof parsed !== typeof initial) return initial
      return parsed as T
    } catch {
      return initial
    }
  })
  const set = useCallback(
    (nv: T) => {
      setV(nv)
      try {
        localStorage.setItem(`vinoh.${key}`, JSON.stringify(nv))
      } catch {
        /* sin localStorage */
      }
    },
    [key],
  )
  return [v, set]
}
