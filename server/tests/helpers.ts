// Ayudas para tests de rutas: levanta la API con una base en memoria nueva.
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { resetInMemoryDatabase } from '../db'
import { createApp } from '../app'

/** Encabezado que la API exige para todo lo que cambia datos (ver server/lib/guard.ts). */
export const WRITE_HEADERS = { 'X-VINOH': '1' } as const

export interface TestServer {
  url: string
  close: () => Promise<void>
  get: <T = any>(path: string) => Promise<{ status: number; body: T }>
  post: <T = any>(path: string, body?: unknown) => Promise<{ status: number; body: T }>
  put: <T = any>(path: string, body?: unknown) => Promise<{ status: number; body: T }>
  del: <T = any>(path: string) => Promise<{ status: number; body: T }>
  raw: (path: string, init?: RequestInit) => Promise<Response>
}

/** Base nueva + servidor en un puerto libre. Llamalo en beforeEach/beforeAll. */
export async function startTestServer(): Promise<TestServer> {
  resetInMemoryDatabase()
  const app = createApp()
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  const { port } = server.address() as AddressInfo
  const url = `http://127.0.0.1:${port}`
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${url}/api${path}`, {
      method,
      headers: { ...(method === 'GET' ? {} : WRITE_HEADERS), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    let parsed: any = text
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      /* no es JSON */
    }
    return { status: res.status, body: parsed }
  }
  return {
    url,
    close: () => new Promise((r) => server.close(() => r())),
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b ?? {}),
    put: (p, b) => call('PUT', p, b ?? {}),
    del: (p) => call('DELETE', p),
    // Como las pantallas: todo lo que no es leer lleva el encabezado X-VINOH (salvo que el test
    // pase sus propios headers con X-VINOH distinto, para probar el rechazo).
    raw: (p, init) => {
      const method = (init?.method ?? 'GET').toUpperCase()
      if (method === 'GET' || method === 'HEAD') return fetch(`${url}/api${p}`, init)
      const headers = new Headers(init?.headers)
      if (!headers.has('X-VINOH')) headers.set('X-VINOH', '1')
      return fetch(`${url}/api${p}`, { ...init, headers })
    },
  }
}
