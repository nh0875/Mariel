// Ayudas para tests de rutas: levanta la API con una base en memoria nueva.
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { resetInMemoryDatabase } from '../db'
import { createApp } from '../app'

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
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
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
    raw: (p, init) => fetch(`${url}/api${p}`, init),
  }
}
