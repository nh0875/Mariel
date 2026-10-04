// La API solo atiende a las pantallas del programa: ni otra página web (CSRF) ni un dominio
// que apunte a 127.0.0.1 (DNS rebinding) pueden leer o cambiar los datos.
import http from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hostName, isLocalHost } from '../lib/guard'
import { startTestServer, type TestServer } from './helpers'

let t: TestServer

beforeEach(async () => {
  t = await startTestServer()
})
afterEach(async () => {
  await t.close()
})

/** Pedido "a mano" con node:http para poder elegir el Host (fetch no deja cambiarlo). */
function rawRequest(path: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  const u = new URL(t.url)
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = http.request(
      { host: u.hostname, port: u.port, path: `/api${path}`, method: opts.method ?? 'GET', headers: opts.headers },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          let body: any = data
          try {
            body = data ? JSON.parse(data) : null
          } catch {
            /* no es JSON */
          }
          resolve({ status: res.statusCode ?? 0, body })
        })
      },
    )
    req.on('error', reject)
    if (opts.body) req.write(opts.body)
    req.end()
  })
}

describe('Host permitido (DNS rebinding)', () => {
  it('reconoce los nombres locales con o sin puerto', () => {
    expect(hostName('LocalHost:3030')).toBe('localhost')
    expect(hostName('[::1]:3030')).toBe('[::1]')
    expect(isLocalHost('localhost')).toBe(true)
    expect(isLocalHost('127.0.0.1:5173')).toBe(true)
    expect(isLocalHost('[::1]:3030')).toBe(true)
    expect(isLocalHost('evil.example.com:3030')).toBe(false)
    expect(isLocalHost('localhost.evil.com')).toBe(false)
    expect(isLocalHost('127.0.0.1.nip.io')).toBe(false)
    expect(isLocalHost(undefined)).toBe(false)
  })

  it('rechaza con 403 y mensaje en castellano un Host de otro dominio, aunque sea una lectura', async () => {
    const r = await rawRequest('/export/all', { headers: { Host: 'evil.attacker.com:3030' } })
    expect(r.status).toBe(403)
    expect(r.body.error).toMatch(/solo responde cuando lo abrís desde esta computadora/)
    const r2 = await rawRequest('/health', { headers: { Host: 'localhost.evil.com' } })
    expect(r2.status).toBe(403)
  })

  it('acepta localhost, 127.0.0.1 y [::1] con cualquier puerto (incluido el proxy de Vite)', async () => {
    for (const host of ['localhost:3030', '127.0.0.1:5173', '[::1]:3030', 'localhost']) {
      const r = await rawRequest('/health', { headers: { Host: host } })
      expect(r.status, host).toBe(200)
      expect(r.body.app).toBe('VINOH! Finanzas')
    }
  })
})

describe('Cambios solo desde las pantallas del programa (CSRF)', () => {
  it('un POST sin el encabezado X-VINOH (como un formulario o un fetch no-cors de otra página) no hace nada', async () => {
    await t.post('/products', { name: 'Malbec Testigo', price_retail: 1000, initial_stock: 0 })
    // Igual que el ataque: fetch 'no-cors' / <form enctype=text/plain> a /data/reset.
    const res = await fetch(`${t.url}/api/data/reset`, { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: 'http://localhost:5999' }, body: 'x' })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/solo acepta cambios hechos desde sus propias pantallas/)
    const products = await t.get('/products')
    expect(products.body.map((p: any) => p.name)).toContain('Malbec Testigo')
  })

  it('rechaza también subidas de archivo, borrados y PUT sin el encabezado', async () => {
    const up = await fetch(`${t.url}/api/backups/restore-upload`, { method: 'POST', body: new Uint8Array([1, 2, 3]) })
    expect(up.status).toBe(403)
    const del = await fetch(`${t.url}/api/products/1`, { method: 'DELETE' })
    expect(del.status).toBe(403)
    const put = await fetch(`${t.url}/api/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    expect(put.status).toBe(403)
    const wrong = await fetch(`${t.url}/api/demo/load`, { method: 'POST', headers: { 'X-VINOH': '0' } })
    expect(wrong.status).toBe(403)
  })

  it('no contesta preflights (OPTIONS): un sitio de afuera no puede pedir permiso para mandar el encabezado', async () => {
    const res = await fetch(`${t.url}/api/data/reset`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://evil.example.com', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-vinoh' },
    })
    expect(res.status).toBe(403)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(res.headers.get('access-control-allow-headers')).toBeNull()
  })

  it('con el encabezado funciona normal, y las lecturas y descargas (GET) no lo necesitan', async () => {
    const created = await fetch(`${t.url}/api/products`, {
      method: 'POST',
      headers: { 'X-VINOH': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Con encabezado', price_retail: 1000, initial_stock: 0 }),
    })
    expect(created.status).toBe(201)
    expect((await fetch(`${t.url}/api/products`)).status).toBe(200)
    const xlsx = await fetch(`${t.url}/api/products/export`)
    expect(xlsx.status).toBe(200)
    expect(xlsx.headers.get('content-type')).toMatch(/spreadsheetml/)
  })
})
