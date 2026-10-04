// npm run demo → borra los datos y carga los de ejemplo (en la base configurada por VINOH_DATA_DIR o ./data).
import '../lib/quiet'

const { loadDemoData } = await import('../seed/demo')
const { DB_PATH } = await import('../db')
const { createBackup } = await import('../lib/backup')
try {
  createBackup('antes-de-demo')
} catch {
  /* base nueva */
}
const t0 = Date.now()
const counts = loadDemoData()
console.log(`🍷 Datos de ejemplo cargados en ${DB_PATH} (${((Date.now() - t0) / 1000).toFixed(1)} s):`, counts)
