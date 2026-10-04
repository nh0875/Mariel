// Copias de seguridad y restauración CON DISCO (no en memoria): una carpeta de datos temporal.
// Se fija VINOH_DATA_DIR antes de importar la base (vitest corre cada archivo en su propio proceso).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vinoh-backup-test-'))
process.env.VINOH_DATA_DIR = DIR

const dbMod = await import('../db')
const backup = await import('../lib/backup')
const { createApp } = await import('../app')
const { DB_PATH, BACKUP_DIR, closeDatabase, run, scalar, tx } = dbMod

let server: Server
let base = ''

async function call(method: string, p: string, body?: BodyInit, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/api${p}`, { method, body, headers: method === 'GET' ? headers : { 'X-VINOH': '1', ...headers } })
  const text = await res.text()
  let json: any = text
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* no es JSON */
  }
  return { status: res.status, body: json }
}
const upload = (buf: Buffer | Uint8Array) => call('POST', '/backups/restore-upload', new Uint8Array(buf), { 'Content-Type': 'application/octet-stream' })

/** Muchas filas, así la base ocupa bastantes páginas y se puede "romper" el medio del archivo. */
function seed(name: string, rows = 3000) {
  run('INSERT INTO products (name, price_retail) VALUES (?, 1000)', [name])
  const acc = scalar<number>('SELECT id FROM accounts ORDER BY id LIMIT 1')
  tx(() => {
    for (let i = 0; i < rows; i++) {
      run("INSERT INTO payments (date, account_id, direction, amount, ref_type, description) VALUES ('2026-01-01', ?, 'in', 10, 'aporte', ?)", [acc, `${name} movimiento de prueba número ${i} con texto para ocupar lugar`])
    }
  })
}
const productNames = () => (dbMod.all<{ name: string }>('SELECT name FROM products ORDER BY id') as { name: string }[]).map((r) => r.name)

function backups() {
  return fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.db'))
}

/** Copia de la base con los bytes del medio en cero (como una copia cortada o un pendrive con problemas). */
function corruptCopy(src: string, dest: string) {
  const buf = fs.readFileSync(src)
  const page = 4096
  const pages = Math.floor(buf.length / page)
  expect(pages).toBeGreaterThan(20)
  buf.fill(0, page * Math.floor(pages / 3), page * Math.floor((2 * pages) / 3))
  fs.writeFileSync(dest, buf)
}

/** Copia de la base con otra marca de versión. */
function withUserVersion(src: string, dest: string, v: number) {
  fs.copyFileSync(src, dest)
  const c = new DatabaseSync(dest)
  c.exec(`PRAGMA user_version = ${v}`)
  c.close()
}

beforeAll(async () => {
  const app = createApp()
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()))
  closeDatabase()
  fs.rmSync(DIR, { recursive: true, force: true })
})

let good = ''
beforeEach(async () => {
  // Estado conocido: base sana con "Original" + una copia buena de ese estado.
  await call('POST', '/data/reset')
  seed('Original')
  const made = await call('POST', '/backups')
  expect(made.status).toBe(201)
  good = path.join(BACKUP_DIR, made.body.file)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('Restaurar una copia sana', () => {
  it('vuelve al estado de la copia y guarda antes una copia "antes de restaurar"', async () => {
    run("INSERT INTO products (name, price_retail) VALUES ('Agregado después', 1)")
    expect(productNames()).toContain('Agregado después')
    const r = await call('POST', `/backups/${path.basename(good)}/restore`)
    expect(r.status).toBe(200)
    expect(productNames()).toEqual(['Original'])
    expect(backups().some((f) => f.startsWith('vinoh-antes-de-restaurar-'))).toBe(true)
    expect((await call('GET', '/dashboard')).status).toBe(200)
    // Sin archivos de trabajo colgados.
    expect(fs.existsSync(DB_PATH + '.restoring')).toBe(false)
    expect(fs.existsSync(DB_PATH + '.previous')).toBe(false)
    expect(fs.readdirSync(BACKUP_DIR).filter((f) => f.includes('.tmp'))).toEqual([])
  })

  it('también desde un archivo subido', async () => {
    run("INSERT INTO products (name, price_retail) VALUES ('Agregado después', 1)")
    const r = await upload(fs.readFileSync(good))
    expect(r.status).toBe(200)
    expect(productNames()).toEqual(['Original'])
  })
})

describe('Copias dañadas o incompatibles: se rechazan sin tocar los datos', () => {
  it('una copia con el medio en cero (cortada) → 400 "dañada"; los datos actuales siguen igual', async () => {
    run("INSERT INTO products (name, price_retail) VALUES ('Dato actual', 1)")
    const bad = path.join(DIR, 'rota.db')
    corruptCopy(good, bad)
    const before = backups().length
    const r = await upload(fs.readFileSync(bad))
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/está dañada/)
    expect(r.body.error).toMatch(/no se tocaron/)
    expect(productNames()).toEqual(['Original', 'Dato actual'])
    expect(backups().length).toBe(before) // ni siquiera hizo la copia "antes de restaurar"
    for (const p of ['/dashboard', '/reports/pnl', '/system']) expect((await call('GET', p)).status, p).toBe(200)
  })

  it('una copia sin marca de versión (user_version 0) → 400 y el programa sigue andando (y vuelve a arrancar)', async () => {
    const v0 = path.join(DIR, 'v0.db')
    withUserVersion(good, v0, 0)
    const r = await upload(fs.readFileSync(v0))
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/marca de versión/)
    expect((await call('GET', '/dashboard')).status).toBe(200)
    // Reabrir la base (como al reiniciar el programa) funciona.
    closeDatabase()
    expect(productNames()).toEqual(['Original'])
  })

  it('una copia de una versión más nueva del programa → 400 con qué hacer', async () => {
    const v99 = path.join(DIR, 'v99.db')
    withUserVersion(good, v99, 99)
    const r = await upload(fs.readFileSync(v99))
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/versión más nueva/)
    expect(productNames()).toEqual(['Original'])
  })

  it('una base SQLite que no es de VINOH! (le faltan tablas) → 400', async () => {
    const other = path.join(DIR, 'otra.db')
    const c = new DatabaseSync(other)
    c.exec('CREATE TABLE products (id INTEGER); CREATE TABLE sales (id INTEGER); CREATE TABLE payments (id INTEGER); PRAGMA user_version = 1')
    c.close()
    const r = await upload(fs.readFileSync(other))
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/no es una copia completa de VINOH!/)
    expect(productNames()).toEqual(['Original'])
  })

  it('un archivo con la cabecera de SQLite pero basura adentro → 400', async () => {
    const junk = Buffer.alloc(8192, 7)
    Buffer.from('SQLite format 3\0', 'latin1').copy(junk, 0)
    const r = await upload(junk)
    expect(r.status).toBe(400)
    expect(productNames()).toEqual(['Original'])
  })
})

describe('Con la base actual dañada', () => {
  it('se puede volver a una copia buena (la copia "antes de restaurar" se hace igual, tal cual)', async () => {
    closeDatabase()
    corruptCopy(DB_PATH, DB_PATH + '.tmp-corrupt')
    for (const ext of ['-wal', '-shm']) fs.rmSync(DB_PATH + ext, { force: true })
    fs.renameSync(DB_PATH + '.tmp-corrupt', DB_PATH)
    // La base rota da un error en castellano, no el de SQLite en inglés.
    const dash = await call('GET', '/reports/pnl?from=2026-01-01&to=2026-01-31')
    if (dash.status !== 200) expect(dash.body.error).toMatch(/base de datos está dañada|algo salió mal/)
    // Una copia a mano falla con mensaje claro y sin dejar un archivo vacío.
    const before = backups()
    const make = await call('POST', '/backups')
    if (make.status !== 201) {
      expect(make.body.error).toMatch(/dañada|No se pudo hacer la copia/)
      expect(backups()).toEqual(before)
    }
    const r = await call('POST', `/backups/${path.basename(good)}/restore`)
    expect(r.status).toBe(200)
    expect(productNames()).toEqual(['Original'])
    expect(backups().some((f) => f.startsWith('vinoh-antes-de-restaurar-'))).toBe(true)
    expect((await call('GET', '/dashboard')).status).toBe(200)
  })
})

describe('Limpieza y cupos de copias', () => {
  it('no lista ni deja copias vacías; al arrancar borra archivos de trabajo y recupera una base a medio cambiar', () => {
    fs.writeFileSync(path.join(BACKUP_DIR, 'vinoh-manual-2026-01-01-10-00-00-000.db'), '')
    fs.writeFileSync(path.join(BACKUP_DIR, 'upload-123.tmp'), 'x')
    fs.writeFileSync(path.join(BACKUP_DIR, 'upload-123.tmp-wal'), 'x')
    fs.writeFileSync(DB_PATH + '.restoring', 'x')
    expect(backup.listBackups().some((b) => b.size === 0)).toBe(false)
    backup.cleanupLeftovers()
    expect(fs.existsSync(path.join(BACKUP_DIR, 'vinoh-manual-2026-01-01-10-00-00-000.db'))).toBe(false)
    expect(fs.existsSync(path.join(BACKUP_DIR, 'upload-123.tmp'))).toBe(false)
    expect(fs.existsSync(path.join(BACKUP_DIR, 'upload-123.tmp-wal'))).toBe(false)
    expect(fs.existsSync(DB_PATH + '.restoring')).toBe(false)

    // El programa se cortó justo después de apartar la base: al arrancar, vuelve a su lugar.
    closeDatabase()
    for (const ext of ['', '-wal', '-shm']) if (fs.existsSync(DB_PATH + ext)) fs.renameSync(DB_PATH + ext, DB_PATH + '.previous' + ext)
    backup.cleanupLeftovers()
    expect(fs.existsSync(DB_PATH)).toBe(true)
    expect(productNames()).toEqual(['Original'])
  })

  it('muchas copias a mano no borran las automáticas ni la última de cada tipo', () => {
    backup.createBackup('auto')
    backup.createBackup('antes-de-borrar')
    for (let i = 0; i < backup.KEEP_OTHER + 5; i++) backup.createBackup('manual')
    const kinds = backup.listBackups().map((b) => backup.backupKind(b.file))
    expect(kinds.filter((k) => k === 'manual').length).toBeLessThanOrEqual(backup.KEEP_OTHER)
    expect(kinds).toContain('auto')
    expect(kinds).toContain('antes-de-borrar')
    // Cupo de "otras" + (a lo sumo) la última de cada tipo de seguridad que se salvó del cupo.
    const safetyKinds = new Set(kinds.filter((k) => k !== 'auto' && k !== 'manual')).size
    expect(kinds.filter((k) => k !== 'auto').length).toBeLessThanOrEqual(backup.KEEP_OTHER + safetyKinds)
  })

  it('la copia automática se hace una vez por día, y el reloj la vuelve a revisar mientras el programa está abierto', () => {
    for (const f of backups()) if (f.startsWith('vinoh-auto-')) fs.rmSync(path.join(BACKUP_DIR, f))
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const timer = backup.startAutoBackupTimer(1000)
    expect(backups().filter((f) => f.startsWith('vinoh-auto-')).length).toBe(0)
    vi.advanceTimersByTime(1000)
    expect(backups().filter((f) => f.startsWith('vinoh-auto-')).length).toBe(1)
    vi.advanceTimersByTime(5000) // mismo día: no duplica
    expect(backups().filter((f) => f.startsWith('vinoh-auto-')).length).toBe(1)
    clearInterval(timer)
  })
})
