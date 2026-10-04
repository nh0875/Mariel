// Arranque "a prueba de todo" para gente que no es de sistemas:
// 1) revisa que Node.js esté instalado y sea nuevo, 2) instala lo necesario la primera vez,
// 3) prepara la interfaz si hubo cambios, 4) abre el programa en el navegador.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(root)
const isWin = process.platform === 'win32'
const say = (msg = '') => console.log(`  ${msg}`)

console.log('')
say('🍷  VINOH! Finanzas')
say('──────────────────────────────')

// 1) Versión de Node
const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 13)) {
  say(`⚠️  Tenés Node.js ${process.versions.node} y hace falta la versión 22.13 o más nueva.`)
  say('    Bajá la versión "LTS" de https://nodejs.org/es/download, instalala y volvé a abrir VINOH!.')
  process.exit(1)
}

function run(cmd, args, label) {
  say(label)
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: isWin })
  if (r.status !== 0) {
    say('')
    say('❌  Algo falló en este paso. Revisá tu conexión a internet (solo se necesita la primera vez) y probá de nuevo.')
    process.exit(1)
  }
}

// 2) Dependencias
const lock = path.join(root, 'package-lock.json')
const installedMarker = path.join(root, 'node_modules', '.package-lock.json')
const needInstall =
  !fs.existsSync(installedMarker) || (fs.existsSync(lock) && fs.statSync(lock).mtimeMs > fs.statSync(installedMarker).mtimeMs + 1000)
if (needInstall) {
  run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], '📦  Instalando lo necesario (solo la primera vez, puede tardar unos minutos)…')
}

// 3) Interfaz compilada al día
function newestMtime(dir) {
  let newest = 0
  if (!fs.existsSync(dir)) return 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'dist' || entry.name === 'node_modules') continue
      newest = Math.max(newest, newestMtime(full))
    } else newest = Math.max(newest, fs.statSync(full).mtimeMs)
  }
  return newest
}
const distIndex = path.join(root, 'client', 'dist', 'index.html')
const sourcesNewest = Math.max(newestMtime(path.join(root, 'client')), newestMtime(path.join(root, 'shared')))
if (!fs.existsSync(distIndex) || fs.statSync(distIndex).mtimeMs < sourcesNewest) {
  run('npm', ['run', 'build', '--silent'], '🎨  Preparando la pantalla…')
}

// 4) Arrancar
say('🚀  Abriendo VINOH! en tu navegador…')
const child = spawn(isWin ? 'npx.cmd' : 'npx', ['tsx', 'server/index.ts'], {
  stdio: 'inherit',
  shell: isWin,
  env: { ...process.env, VINOH_OPEN_BROWSER: '1' },
})
child.on('exit', (code) => process.exit(code ?? 0))
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig))
