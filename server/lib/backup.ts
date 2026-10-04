// Copias de seguridad automáticas.
// Cada vez que se abre el programa (una vez por día) se guarda una copia completa en
// data/backups/. Se conservan las últimas 30. Si algo sale mal, se puede volver a una copia
// desde Configuración → Copias de seguridad.
import fs from 'node:fs'
import path from 'node:path'
import { BACKUP_DIR, DB_PATH, IN_MEMORY, closeDatabase, db } from '../db'
import { today } from '../../shared/dates'
import { DatabaseSync } from 'node:sqlite'

const KEEP = 30

export interface BackupInfo {
  file: string
  size: number
  created_at: string
}

function sqlQuote(s: string) {
  return `'${s.replace(/'/g, "''")}'`
}

/** Crea una copia de la base. Devuelve la ruta del archivo. */
export function createBackup(label = 'manual'): string {
  if (IN_MEMORY) throw new Error('No hay base en disco')
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
  const file = path.join(BACKUP_DIR, `vinoh-${label}-${stamp}.db`)
  db().exec(`VACUUM INTO ${sqlQuote(file)}`)
  prune()
  return file
}

/** Backup automático diario (se llama al arrancar). */
export function autoBackup() {
  if (IN_MEMORY || !fs.existsSync(DB_PATH)) return
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true })
    const todays = fs.readdirSync(BACKUP_DIR).some((f) => f.startsWith('vinoh-auto-') && f.includes(today()))
    if (!todays) createBackup('auto')
  } catch (err) {
    console.warn('[VINOH] No se pudo hacer el backup automático:', (err as Error).message)
  }
}

function prune() {
  const files = listBackups()
  for (const f of files.slice(KEEP)) {
    try {
      fs.unlinkSync(path.join(BACKUP_DIR, f.file))
    } catch {
      /* no pasa nada */
    }
  }
}

export function listBackups(): BackupInfo[] {
  if (IN_MEMORY || !fs.existsSync(BACKUP_DIR)) return []
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.db'))
    .map((file) => {
      const st = fs.statSync(path.join(BACKUP_DIR, file))
      return { file, size: st.size, created_at: st.mtime.toISOString() }
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export function backupPath(file: string): string {
  const safe = path.basename(file)
  const full = path.join(BACKUP_DIR, safe)
  if (!safe.endsWith('.db') || !fs.existsSync(full)) throw new Error('Backup inexistente')
  return full
}

/** Verifica que un archivo sea una base de VINOH! válida. */
export function isValidVinohDb(file: string): boolean {
  try {
    const test = new DatabaseSync(file, { readOnly: true })
    const t = test.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('products','sales','payments')").all()
    test.close()
    return t.length === 3
  } catch {
    return false
  }
}

/**
 * Reemplaza la base actual por un backup (archivo .db). Antes guarda una copia de la base actual
 * por si te arrepentís.
 */
export function restoreFromFile(sourceFile: string) {
  if (IN_MEMORY) throw new Error('No hay base en disco')
  if (!isValidVinohDb(sourceFile)) throw new Error('El archivo no es una copia de seguridad de VINOH! válida.')
  createBackup('antes-de-restaurar')
  const tmp = DB_PATH + '.restoring'
  fs.copyFileSync(sourceFile, tmp)
  closeDatabase()
  for (const ext of ['-wal', '-shm']) {
    try {
      fs.unlinkSync(DB_PATH + ext)
    } catch {
      /* puede no existir */
    }
  }
  fs.renameSync(tmp, DB_PATH)
  db() // reabre y aplica migraciones si la copia es de una versión anterior
}

/** Igual que restoreFromFile pero desde un archivo subido (Buffer). */
export function restoreFromBuffer(buf: Buffer) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  const tmp = path.join(BACKUP_DIR, `upload-${Date.now()}.tmp`)
  fs.writeFileSync(tmp, buf)
  try {
    restoreFromFile(tmp)
  } finally {
    try {
      fs.unlinkSync(tmp)
    } catch {
      /* ok */
    }
  }
}
