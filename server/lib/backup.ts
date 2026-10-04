// Copias de seguridad.
// - Automática: una por día. Se hace al abrir el programa y, si queda abierto varios días, el
//   servidor revisa cada hora si ya hay copia de hoy (startAutoBackupTimer).
// - Hechas a mano y "de seguridad" (antes de borrar todo, cargar el ejemplo o restaurar).
// Las automáticas y las demás tienen cupos separados (KEEP_AUTO / KEEP_OTHER): hacer muchas copias
// a mano nunca borra las automáticas, y siempre queda la última copia de cada tipo.
// Si algo sale mal, se puede volver a una copia desde Configuración → Copias de seguridad.
//
// Restaurar es seguro: antes de tocar la base que se está usando, la copia elegida se revisa
// (que sea SQLite, que no esté dañada, que tenga las tablas de VINOH! y que no sea de una versión
// más nueva del programa) y se prueba abrirla. Si después del cambio algo falla, se vuelve solo a
// la base anterior.
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { BACKUP_DIR, DB_PATH, IN_MEMORY, REQUIRED_TABLES, SCHEMA_VERSION, closeDatabase, db, migrate } from '../db'
import { today, toISODate } from '../../shared/dates'

/** Copias automáticas que se guardan (una por día → un mes). */
export const KEEP_AUTO = 30
/** Copias hechas a mano o de seguridad (antes de borrar, de cargar el ejemplo o de restaurar). */
export const KEEP_OTHER = 30

export interface BackupInfo {
  file: string
  size: number
  created_at: string
}

/** Error de restauración con un mensaje listo para mostrarle a la persona. */
export class RestoreError extends Error {}

function sqlQuote(s: string) {
  return `'${s.replace(/'/g, "''")}'`
}

/** Tipo de copia según el nombre ("vinoh-manual-2026-01-31-10-00-00-123.db" → "manual"). */
export function backupKind(file: string): string {
  const m = /^vinoh-(.+?)-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}(?:-\d{3})?(?:-\d+)?\.db$/.exec(file)
  return m ? m[1] : 'otra'
}

function rm(file: string) {
  try {
    fs.unlinkSync(file)
  } catch {
    /* puede no existir */
  }
}

/** Borra un archivo .db y sus acompañantes de SQLite (-wal, -shm, -journal). */
function rmDb(file: string) {
  for (const ext of ['', '-wal', '-shm', '-journal']) rm(file + ext)
}

function newBackupFile(label: string): string {
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  // Fecha y hora LOCAL (así "auto de hoy" coincide con today()), con milisegundos para que
  // dos copias en el mismo segundo no se pisen.
  const d = new Date()
  const p2 = (n: number, l = 2) => String(n).padStart(l, '0')
  const stamp = `${toISODate(d)}-${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}-${p2(d.getMilliseconds(), 3)}`
  let file = path.join(BACKUP_DIR, `vinoh-${label}-${stamp}.db`)
  for (let i = 2; fs.existsSync(file); i++) file = path.join(BACKUP_DIR, `vinoh-${label}-${stamp}-${i}.db`)
  return file
}

/** Crea una copia de la base. Devuelve la ruta del archivo. */
export function createBackup(label = 'manual'): string {
  if (IN_MEMORY) throw new Error('No hay base en disco')
  const file = newBackupFile(label)
  try {
    db().exec(`VACUUM INTO ${sqlQuote(file)}`)
  } catch (err) {
    // Nunca dejar un archivo vacío o a medias que después aparezca como una copia buena.
    rmDb(file)
    throw new RestoreError(
      isCorruptError(err)
        ? 'No se pudo hacer la copia porque la base de datos actual está dañada. Podés volver a una copia anterior desde Configuración → Copias de seguridad.'
        : `No se pudo hacer la copia de seguridad (${(err as Error).message}). Revisá que haya espacio libre en el disco.`,
    )
  }
  prune()
  return file
}

/**
 * Copia de seguridad que no puede fallar por la base dañada: intenta la copia normal y, si la base
 * actual está rota, copia el archivo tal cual (así igual queda "por si te arrepentís").
 */
function safetyCopy(label: string): string | null {
  if (!fs.existsSync(DB_PATH)) return null
  try {
    return createBackup(label)
  } catch {
    const file = newBackupFile(label)
    try {
      try {
        db().exec('PRAGMA wal_checkpoint(TRUNCATE)')
      } catch {
        /* base rota: copiamos lo que haya */
      }
      fs.copyFileSync(DB_PATH, file)
      if (fs.existsSync(DB_PATH + '-wal')) fs.copyFileSync(DB_PATH + '-wal', file + '-wal')
      prune()
      return file
    } catch (err) {
      rmDb(file)
      throw new RestoreError(`No pudimos guardar una copia de tus datos actuales antes de restaurar (${(err as Error).message}). No cambiamos nada. Revisá que haya espacio libre en el disco.`)
    }
  }
}

/** ¿Ya hay copia automática de hoy? */
function hasTodaysAuto(): boolean {
  const t = today()
  return fs.readdirSync(BACKUP_DIR).some((f) => f.startsWith(`vinoh-auto-${t}`) && f.endsWith('.db') && safeSize(path.join(BACKUP_DIR, f)) > 0)
}

function safeSize(file: string): number {
  try {
    return fs.statSync(file).size
  } catch {
    return 0
  }
}

/** Backup automático diario (se llama al arrancar y cada hora mientras el programa está abierto). */
export function autoBackup(): string | null {
  if (IN_MEMORY || !fs.existsSync(DB_PATH)) return null
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true })
    if (!hasTodaysAuto()) return createBackup('auto')
  } catch (err) {
    console.warn('[VINOH] No se pudo hacer el backup automático:', (err as Error).message)
  }
  return null
}

/**
 * Mientras el programa está abierto, revisa cada hora si ya se hizo la copia de hoy (muchos dejan la
 * ventana abierta varios días). autoBackup no duplica: hace una sola por día.
 */
export function startAutoBackupTimer(everyMs = 60 * 60 * 1000): NodeJS.Timeout {
  const timer = setInterval(() => autoBackup(), everyMs)
  timer.unref() // no impide que el programa se cierre
  return timer
}

/** Borra las copias más viejas: cupos separados para automáticas y el resto; la última de cada tipo se queda siempre. */
function prune() {
  const files = listBackups()
  const newestOfKind = new Set<string>()
  const seen = new Set<string>()
  for (const f of files) {
    const k = backupKind(f.file)
    if (!seen.has(k)) {
      seen.add(k)
      newestOfKind.add(f.file)
    }
  }
  const autos = files.filter((f) => backupKind(f.file) === 'auto')
  const others = files.filter((f) => backupKind(f.file) !== 'auto')
  const drop = [...autos.slice(KEEP_AUTO), ...others.slice(KEEP_OTHER)].filter((f) => !newestOfKind.has(f.file))
  for (const f of drop) rmDb(path.join(BACKUP_DIR, f.file))
}

/** Copias guardadas, la más nueva primero (no muestra archivos vacíos ni temporales). */
export function listBackups(): BackupInfo[] {
  if (IN_MEMORY || !fs.existsSync(BACKUP_DIR)) return []
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.db'))
    .map((file) => {
      const st = fs.statSync(path.join(BACKUP_DIR, file))
      return { file, size: st.size, created_at: st.mtime.toISOString() }
    })
    .filter((b) => b.size > 0)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.file.localeCompare(a.file))
}

export function backupPath(file: string): string {
  const safe = path.basename(file)
  const full = path.join(BACKUP_DIR, safe)
  if (!safe.endsWith('.db') || !fs.existsSync(full)) throw new Error('Backup inexistente')
  return full
}

function isCorruptError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err)
  return /malformed|not a database|file is not a database|SQLITE_CORRUPT|SQLITE_NOTADB|disk image/i.test(msg)
}

const BAD_FILE_MSG = 'Ese archivo no es una copia de seguridad de VINOH!. Tiene que ser un archivo que termine en .db (por ejemplo, vinoh-manual-2026-01-31-….db).'
const DAMAGED_MSG =
  'Esa copia está dañada (puede que se haya cortado al copiarla o al bajarla, o que el pendrive tenga un problema), así que no la usamos. Tus datos actuales no se tocaron. Probá con otra copia.'

/**
 * Revisa una base candidata y la deja lista para usar (aplica migraciones si es de una versión
 * anterior). Trabaja SOBRE ESE ARCHIVO, así que pasale una copia. Si algo no va, tira RestoreError
 * con el motivo en castellano.
 */
export function checkAndPrepareDb(file: string) {
  let conn: DatabaseSync | null = null
  try {
    try {
      conn = new DatabaseSync(file)
      conn.prepare('SELECT COUNT(*) FROM sqlite_master').get()
    } catch (err) {
      throw new RestoreError(/not a database|NOTADB/i.test(String((err as Error)?.message)) ? BAD_FILE_MSG : DAMAGED_MSG)
    }
    let check: string[]
    try {
      check = conn
        .prepare('PRAGMA integrity_check(5)')
        .all()
        .map((r) => String(Object.values(r)[0]))
    } catch {
      throw new RestoreError(DAMAGED_MSG)
    }
    if (check.length !== 1 || check[0] !== 'ok') throw new RestoreError(DAMAGED_MSG)

    const tables = new Set(
      conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((r) => String(r.name)),
    )
    const missing = REQUIRED_TABLES.filter((t) => !tables.has(t))
    if (missing.length) {
      throw new RestoreError(
        missing.length === REQUIRED_TABLES.length
          ? BAD_FILE_MSG
          : 'Ese archivo no es una copia completa de VINOH! (le faltan partes de la base), así que no lo usamos. Tus datos actuales no se tocaron.',
      )
    }
    const version = Number((conn.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
    if (version > SCHEMA_VERSION) {
      throw new RestoreError(
        'Esa copia es de una versión más nueva de VINOH! que la que tenés en esta computadora. Actualizá el programa (copiá la versión nueva) y después restaurala. Tus datos actuales no se tocaron.',
      )
    }
    if (version < 1) {
      throw new RestoreError('Ese archivo no tiene la marca de versión de VINOH! (no lo hizo el programa o se modificó a mano), así que no lo usamos. Tus datos actuales no se tocaron.')
    }
    try {
      migrate(conn)
      conn.prepare('SELECT COUNT(*) FROM products').get()
      conn.prepare('SELECT COUNT(*) FROM payments').get()
    } catch {
      throw new RestoreError('No pudimos adaptar esa copia a esta versión del programa, así que no la usamos. Tus datos actuales no se tocaron.')
    }
    try {
      // Que quede como un solo archivo (sin -wal) antes de ponerla en su lugar.
      conn.exec('PRAGMA journal_mode = DELETE')
    } catch {
      /* no es grave */
    }
  } finally {
    try {
      conn?.close()
    } catch {
      /* ya está */
    }
  }
}

/** Verifica que un archivo sea una base de VINOH! sana, sin modificarlo. */
export function isValidVinohDb(file: string): boolean {
  const probe = `${file}.probe-${process.pid}-${Date.now()}`
  try {
    fs.copyFileSync(file, probe)
    checkAndPrepareDb(probe)
    return true
  } catch {
    return false
  } finally {
    rmDb(probe)
  }
}

function moveDb(from: string, to: string) {
  rmDb(to)
  for (const ext of ['', '-wal', '-shm']) {
    if (fs.existsSync(from + ext)) fs.renameSync(from + ext, to + ext)
  }
}

/** Abre la base que quedó en DB_PATH y la prueba con una consulta real. */
function reopenAndProbe() {
  closeDatabase()
  const conn = db()
  conn.prepare('SELECT COUNT(*) FROM products').get()
  conn.prepare('SELECT COUNT(*) FROM settings').get()
}

/**
 * Reemplaza la base actual por un backup (archivo .db). Pasos:
 * 1. Copia la elegida a un archivo de trabajo, la revisa y la prepara (si no sirve, no se toca nada).
 * 2. Guarda una copia de la base actual ("antes de restaurar"), aunque esté dañada.
 * 3. Cambia los archivos y abre la nueva. Si falla, vuelve sola a la base anterior.
 */
export function restoreFromFile(sourceFile: string) {
  if (IN_MEMORY) throw new Error('No hay base en disco')
  // Primero copiamos la copia elegida: al guardar el "antes de restaurar" se borran las copias
  // más viejas, y podría ser justo la que estamos restaurando.
  const staging = DB_PATH + '.restoring'
  rmDb(staging)
  try {
    fs.copyFileSync(sourceFile, staging)
    checkAndPrepareDb(staging)
  } catch (err) {
    rmDb(staging)
    if (err instanceof RestoreError) throw err
    throw new RestoreError(`No pudimos leer esa copia (${(err as Error).message}). Tus datos actuales no se tocaron.`)
  }

  try {
    safetyCopy('antes-de-restaurar')
  } catch (err) {
    rmDb(staging)
    throw err
  }

  const previous = DB_PATH + '.previous'
  closeDatabase()
  try {
    moveDb(DB_PATH, previous)
    moveDb(staging, DB_PATH)
    reopenAndProbe()
  } catch (err) {
    // Algo falló con la base nueva: volvemos a dejar la de antes.
    try {
      closeDatabase()
    } catch {
      /* ya estaba cerrada */
    }
    rmDb(DB_PATH)
    if (fs.existsSync(previous)) moveDb(previous, DB_PATH)
    rmDb(staging)
    try {
      db()
    } catch {
      /* si la anterior tampoco abre, el error de abajo lo explica */
    }
    throw new RestoreError(`No pudimos abrir esa copia, así que volvimos a dejar tus datos como estaban (${(err as Error).message}).`)
  }
  rmDb(previous)
}

/** Igual que restoreFromFile pero desde un archivo subido (Buffer). */
export function restoreFromBuffer(buf: Buffer) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  const tmp = path.join(BACKUP_DIR, `upload-${Date.now()}.tmp`)
  fs.writeFileSync(tmp, buf)
  try {
    restoreFromFile(tmp)
  } finally {
    rmDb(tmp)
  }
}

/**
 * Limpieza al arrancar: archivos de trabajo que quedaron de una restauración cortada y copias
 * vacías (de un intento de copia que falló).
 */
export function cleanupLeftovers() {
  if (IN_MEMORY) return
  rmDb(DB_PATH + '.restoring')
  // Si quedó una ".previous" es porque el programa se cortó en el medio de un cambio: si la base
  // actual no existe, la recuperamos; si existe, la anterior ya no hace falta.
  const previous = DB_PATH + '.previous'
  if (fs.existsSync(previous)) {
    if (!fs.existsSync(DB_PATH)) moveDb(previous, DB_PATH)
    else rmDb(previous)
  }
  if (!fs.existsSync(BACKUP_DIR)) return
  for (const f of fs.readdirSync(BACKUP_DIR)) {
    const full = path.join(BACKUP_DIR, f)
    if (/^(upload-|restaurando-).*\.tmp(-wal|-shm|-journal)?$/.test(f) || /\.probe-\d+-\d+(-wal|-shm|-journal)?$/.test(f)) rm(full)
    else if (f.endsWith('.db') && safeSize(full) === 0) rmDb(full)
  }
}
