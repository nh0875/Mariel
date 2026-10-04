// Configuración, copias de seguridad, datos de ejemplo y exportación completa.
// (Ver docs/ARQUITECTURA.md → módulo "Configuración")
import { Router } from 'express'
import { settingsInput } from '../../shared/schemas'
import { validate } from '../lib/http'
import { getSettings, updateSettings } from '../services/settings'
import { loadDemoData } from '../seed/demo'
import { ensureBaseData, wipeAllData } from '../services/setup'
import { createBackup } from '../lib/backup'
import { IN_MEMORY } from '../db'

const router = Router()

router.get('/settings', (_req, res) => {
  res.json(getSettings())
})

router.put('/settings', (req, res) => {
  const patch = validate(settingsInput, req.body)
  res.json(updateSettings(patch))
})

/** Borra todo y carga los datos de ejemplo (antes guarda una copia de seguridad). */
router.post('/demo/load', (_req, res) => {
  if (!IN_MEMORY) createBackup('antes-de-ejemplo')
  const counts = loadDemoData()
  res.json({ ok: true, ...counts })
})

/** Borra todos los datos del negocio (antes guarda una copia de seguridad). La configuración se mantiene. */
router.post('/data/reset', (_req, res) => {
  if (!IN_MEMORY) createBackup('antes-de-borrar')
  wipeAllData()
  ensureBaseData()
  res.json({ ok: true })
})

export default router
