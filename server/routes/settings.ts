// Configuración, copias de seguridad, datos de ejemplo y exportación completa.
// (Ver docs/ARQUITECTURA.md → módulo "Configuración")
import { Router } from 'express'
import { settingsInput } from '../../shared/schemas'
import { validate } from '../lib/http'
import { getSettings, updateSettings } from '../services/settings'

const router = Router()

router.get('/settings', (_req, res) => {
  res.json(getSettings())
})

router.put('/settings', (req, res) => {
  const patch = validate(settingsInput, req.body)
  res.json(updateSettings(patch))
})

export default router
