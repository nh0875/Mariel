import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startTestServer, type TestServer } from './helpers'

let t: TestServer
beforeAll(async () => {
  t = await startTestServer()
})
afterAll(() => t.close())

describe('API base', () => {
  it('responde health y configuración con cuentas por defecto', async () => {
    expect((await t.get('/health')).body.ok).toBe(true)
    const s = await t.get('/settings')
    expect(s.status).toBe(200)
    expect(s.body.payment_methods.find((m: any) => m.key === 'efectivo').account_id).toBeTruthy()
  })
  it('valida la configuración con mensajes en castellano', async () => {
    const r = await t.put('/settings', { usd_rate: -5 })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/Revisá/)
  })
  it('devuelve 404 amable para rutas inexistentes', async () => {
    const r = await t.get('/no-existe')
    expect(r.status).toBe(404)
    expect(r.body.error).toBeTruthy()
  })
})
