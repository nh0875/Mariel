// Arranque "a prueba de todo" para gente que no es de sistemas:
// 1) revisa que Node.js esté instalado y sea nuevo, 2) si VINOH! ya está abierto, solo abre el
// navegador, 3) instala lo necesario la primera vez (o si la carpeta vino de otra computadora),
// 4) prepara la interfaz si hubo cambios, 5) abre el programa en el navegador.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(root)
const isWin = process.platform === 'win32'
const say = (msg = '') => console.log(`  ${msg}`)
const PORT = Number(process.env.PORT || 3030)
const URL = `http://localhost:${PORT}`

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

function openBrowser(url) {
  const cmd = isWin ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`
  spawn(cmd, { shell: true, stdio: 'ignore', detached: true }).on('error', () => {}).unref()
}

// 2) ¿Ya está abierto? Entonces no hace falta instalar ni preparar nada (y no tocamos la
//    interfaz mientras se está usando): solo abrimos el navegador.
async function vinohRunning() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(1500) })
    return (await r.json())?.app === 'VINOH! Finanzas'
  } catch {
    return false
  }
}
if (await vinohRunning()) {
  say(`🍷  VINOH! ya estaba abierto. Te lo abro en el navegador: ${URL}`)
  say('    (Esta ventana se puede cerrar: el programa sigue andando en la otra.)')
  if (process.env.VINOH_OPEN_BROWSER !== '0') openBrowser(URL)
  process.exit(0)
}

/** Corre un comando mostrando su salida. Devuelve true si terminó bien. */
function run(cmd, args, label) {
  if (label) say(label)
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: isWin })
  return r.status === 0
}

function fail(lines) {
  say('')
  for (const l of lines) say(l)
  say('')
  process.exit(1)
}

// 3) Dependencias
// node_modules tiene programas "nativos" que sirven solo para un sistema (Windows, Mac Intel, Mac M1,
// Linux…). Si la carpeta se copió de otra computadora, hay que reinstalar: lo detectamos con una
// marca propia (.vinoh-platform) y probando que esos programas carguen de verdad.
const nodeModules = path.join(root, 'node_modules')
const lock = path.join(root, 'package-lock.json')
const installedMarker = path.join(nodeModules, '.package-lock.json')
const platformMarker = path.join(nodeModules, '.vinoh-platform')
const platformId = `${process.platform}-${process.arch}-node${process.versions.modules}`

/** Prueba que carguen los módulos nativos que usan el servidor (esbuild) y la interfaz (rolldown, lightningcss, tailwind). */
function probeNative() {
  const probe = `
    const checks = [
      ['esbuild', async () => (await import('esbuild')).transformSync('let a = 1')],
      ['rolldown', async () => { await import('rolldown') }],
      ['lightningcss', async () => { (await import('lightningcss')).transform({ filename: 'a.css', code: Buffer.from('a{color:red}') }) }],
      ['@tailwindcss/oxide', async () => { await import('@tailwindcss/oxide') }],
    ]
    for (const [name, check] of checks) {
      try { await check() } catch (e) { console.error(name + ': ' + String(e && e.message || e).split('\\n')[0]); process.exit(1) }
    }`
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { cwd: root, encoding: 'utf8' })
  return { ok: r.status === 0, error: (r.stderr || r.stdout || '').trim() }
}

function readMarker() {
  try {
    return fs.readFileSync(platformMarker, 'utf8').trim()
  } catch {
    return null
  }
}

function install(clean, label) {
  if (clean) {
    say('🧹  Borrando la instalación anterior (era de otra computadora o estaba incompleta)…')
    try {
      fs.rmSync(nodeModules, { recursive: true, force: true })
    } catch (err) {
      fail([
        '❌  No pudimos borrar la carpeta node_modules para reinstalar.',
        `    Detalle: ${err.message}`,
        '    Cerrá VINOH! (y cualquier otra ventana negra), borrá a mano la carpeta "node_modules" de VINOH! y volvé a abrirlo.',
      ])
    }
  }
  const ok = run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], label)
  if (!ok) {
    fail([
      '❌  No se pudo instalar lo necesario.',
      '    Lo más común es que no haya internet (solo hace falta la primera vez o al pasar VINOH! a otra computadora).',
      '    Revisá la conexión y volvé a abrir VINOH!. Si tenés internet y sigue fallando, mandale a quien te ayuda con el sistema lo que se ve arriba.',
    ])
  }
  try {
    fs.writeFileSync(platformMarker, platformId)
  } catch {
    /* sin marca, la próxima vez se prueba de nuevo */
  }
}

const hasModules = fs.existsSync(installedMarker)
const lockChanged = hasModules && fs.existsSync(lock) && fs.statSync(lock).mtimeMs > fs.statSync(installedMarker).mtimeMs + 1000
const marker = hasModules ? readMarker() : null
if (!hasModules) {
  install(false, '📦  Instalando lo necesario (solo la primera vez, puede tardar unos minutos)…')
} else if (marker && marker !== platformId) {
  say(`🔁  Esta carpeta se instaló en otra computadora (${marker}); esta es ${platformId}.`)
  install(true, '📦  Instalando lo necesario para esta computadora (puede tardar unos minutos)…')
} else if (lockChanged) {
  install(false, '📦  Actualizando lo necesario (puede tardar unos minutos)…')
}
{
  // Siempre probamos que lo nativo cargue (es rápido). Si no, reinstalamos de cero una vez.
  const p = probeNative()
  if (!p.ok) {
    say('🔁  Lo instalado no funciona en esta computadora; lo reinstalo.')
    say(`    (Detalle: ${p.error || 'sin detalle'})`)
    install(true, '📦  Instalando lo necesario para esta computadora (puede tardar unos minutos)…')
    const again = probeNative()
    if (!again.ok) {
      fail([
        '❌  Lo instalado sigue sin funcionar en esta computadora.',
        `    Detalle: ${again.error || 'sin detalle'}`,
        '    Probá actualizar Node.js (versión LTS de https://nodejs.org/es/download) y volver a abrir VINOH!.',
      ])
    }
  } else if (!marker) {
    try {
      fs.writeFileSync(platformMarker, platformId)
    } catch {
      /* no pasa nada */
    }
  }
}

// 4) Interfaz compilada al día
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
  let ok = run('npm', ['run', 'build', '--silent'], '🎨  Preparando la pantalla…')
  if (!ok) {
    // Puede ser una instalación rota: reinstalamos de cero y probamos una vez más.
    say('🔁  No salió; reinstalo lo necesario y pruebo de nuevo…')
    install(true, '📦  Instalando lo necesario (puede tardar unos minutos)…')
    ok = run('npm', ['run', 'build', '--silent'], '🎨  Preparando la pantalla (segundo intento)…')
  }
  if (!ok) {
    fail([
      '❌  No se pudo preparar la pantalla de VINOH!. El error técnico está arriba.',
      '    No es un problema de internet ni de tus datos (tus datos están a salvo en la carpeta data).',
      '    Mandale a quien te ayuda con el sistema una foto de esta ventana.',
    ])
  }
}

// 5) Arrancar (el servidor abre el navegador cuando está listo, una sola vez).
//    VINOH_OPEN_BROWSER=0 lo arranca sin abrir el navegador (pruebas, otra compu en la red local…).
const openIt = process.env.VINOH_OPEN_BROWSER !== '0'
say(openIt ? '🚀  Abriendo VINOH! en tu navegador…' : '🚀  Arrancando VINOH!…')
const tsxCli = path.join(nodeModules, 'tsx', 'dist', 'cli.mjs')
const env = { ...process.env, VINOH_OPEN_BROWSER: openIt ? '1' : '0' }
const child = fs.existsSync(tsxCli)
  ? spawn(process.execPath, [tsxCli, 'server/index.ts'], { stdio: 'inherit', env })
  : spawn(isWin ? 'npx.cmd' : 'npx', ['tsx', 'server/index.ts'], { stdio: 'inherit', shell: isWin, env })
child.on('exit', (code) => process.exit(code ?? 0))
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig))
