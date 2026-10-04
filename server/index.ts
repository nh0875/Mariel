// Punto de entrada del servidor. Corre SOLO en esta computadora (127.0.0.1):
// nadie de afuera puede entrar.
import './lib/quiet'
import { exec } from 'node:child_process'

// Se importan después de silenciar el aviso de node:sqlite (los import estáticos se resuelven antes).
const { createApp } = await import('./app')
const { autoBackup } = await import('./lib/backup')
const { DB_PATH } = await import('./db')

const PORT = Number(process.env.PORT || 3030)
const HOST = '127.0.0.1'
const URL = `http://localhost:${PORT}`

function openBrowser(url: string) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`
  exec(cmd, () => {
    /* si no se puede abrir, el usuario usa el link de la consola */
  })
}

const app = createApp()
autoBackup()

const server = app.listen(PORT, HOST, () => {
  console.log('')
  console.log('  🍷  VINOH! Finanzas está andando')
  console.log(`  👉  Abrí ${URL} en tu navegador`)
  console.log(`  💾  Tus datos se guardan en: ${DB_PATH}`)
  console.log('  ✋  Para cerrar el programa, cerrá esta ventana (o Ctrl + C).')
  console.log('')
  if (process.env.VINOH_OPEN_BROWSER === '1') openBrowser(URL)
})

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.log('')
    console.log(`  🍷  Parece que VINOH! ya está abierto. Te lo abro en el navegador: ${URL}`)
    console.log('')
    if (process.env.VINOH_OPEN_BROWSER === '1') openBrowser(URL)
    process.exit(0)
  }
  throw err
})
