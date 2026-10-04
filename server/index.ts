// Punto de entrada del servidor. Corre SOLO en esta computadora (127.0.0.1):
// nadie de afuera puede entrar.
import './lib/quiet'
import { exec } from 'node:child_process'

// Se importan después de silenciar el aviso de node:sqlite (los import estáticos se resuelven antes).
const { createApp } = await import('./app')
const { autoBackup, cleanupLeftovers, startAutoBackupTimer } = await import('./lib/backup')
const { DB_PATH, BACKUP_DIR } = await import('./db')

const PORT = Number(process.env.PORT || 3030)
const HOST = '127.0.0.1'
const URL = `http://localhost:${PORT}`
const say = (msg = '') => console.log(msg ? `  ${msg}` : '')

function openBrowser(url: string) {
  if (process.env.VINOH_OPEN_BROWSER !== '1') return
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`
  exec(cmd, () => {
    /* si no se puede abrir, el usuario usa el link de la consola */
  })
}

/** ¿Lo que está en ese puerto es VINOH!? */
async function isVinohRunning(): Promise<boolean> {
  try {
    const r = await fetch(`http://${HOST}:${PORT}/api/health`, { signal: AbortSignal.timeout(2000) })
    const body = (await r.json()) as { app?: string }
    return body?.app === 'VINOH! Finanzas'
  } catch {
    return false
  }
}

function alreadyOpen() {
  say()
  say(`🍷  VINOH! ya estaba abierto. Te lo abro en el navegador: ${URL}`)
  say('    (Esta ventana se puede cerrar: el programa sigue andando en la otra.)')
  say()
  openBrowser(URL)
  process.exit(0)
}

// Si ya está abierto, no tocamos nada (ni limpieza ni copias): solo abrimos el navegador.
if (await isVinohRunning()) alreadyOpen()

cleanupLeftovers()

let app: ReturnType<typeof createApp>
try {
  app = createApp()
} catch (err) {
  // La base no abre (dañada, o de una versión que no entendemos). En vez de un error técnico,
  // explicamos cómo volver a una copia.
  say()
  say('❌  No pudimos abrir tus datos.')
  say(`    Archivo: ${DB_PATH}`)
  say(`    Motivo técnico: ${(err as Error).message}`)
  say()
  say('    Tus copias de seguridad están en:')
  say(`    ${BACKUP_DIR}`)
  say('    Para volver a la última copia buena:')
  say('     1. Cerrá esta ventana.')
  say('     2. Renombrá el archivo vinoh.db (por ejemplo, a vinoh-roto.db).')
  say('     3. Copiá la copia más nueva de la carpeta backups a la carpeta de vinoh.db y ponele de nombre vinoh.db.')
  say('     4. Volvé a abrir VINOH!.')
  say()
  process.exit(1)
}

autoBackup()
startAutoBackupTimer() // si queda abierto varios días, igual hace la copia diaria

const server = app.listen(PORT, HOST)

server.once('listening', () => {
  say()
  say('🍷  VINOH! Finanzas está andando')
  say(`👉  Abrí ${URL} en tu navegador`)
  say(`💾  Tus datos se guardan en: ${DB_PATH}`)
  say('✋  Para cerrar el programa, cerrá esta ventana (o Ctrl + C).')
  say()
  openBrowser(URL)
})

server.on('error', async (err: NodeJS.ErrnoException) => {
  say()
  if (err.code === 'EADDRINUSE') {
    if (await isVinohRunning()) alreadyOpen()
    say(`❌  Otro programa está usando el puerto ${PORT}, así que VINOH! no puede arrancar.`)
    say('    Cerrá ese programa y volvé a abrir VINOH!, o reiniciá la computadora.')
    say(`    (Quien sepa de sistemas puede elegir otro puerto con la variable PORT, por ejemplo PORT=3031.)`)
    say()
    process.exit(1)
  }
  say(`❌  VINOH! no pudo arrancar (${err.code ?? 'error'}: ${err.message}).`)
  say('    Probá reiniciar la computadora y volver a abrirlo.')
  say()
  process.exit(1)
})
