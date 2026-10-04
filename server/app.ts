// Arma la aplicación Express (API + interfaz compilada).
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { PROJECT_ROOT, db } from './db'
import api from './routes'
import { errorHandler } from './lib/http'
import { localOnly } from './lib/guard'
import { ensureBaseData } from './services/setup'

export const CLIENT_DIST = path.join(PROJECT_ROOT, 'client', 'dist')

export function createApp() {
  db()
  ensureBaseData()

  const app = express()
  app.disable('x-powered-by')
  // Antes que nada: la API solo atiende a las pantallas del programa (ver lib/guard.ts).
  app.use('/api', localOnly())
  app.use(express.json({ limit: '10mb' }))

  app.use('/api', api)
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Esa función no existe en el sistema.' })
  })

  if (fs.existsSync(path.join(CLIENT_DIST, 'index.html'))) {
    app.use(express.static(CLIENT_DIST, { index: false, maxAge: '1h' }))
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(CLIENT_DIST, 'index.html'))
    })
  } else {
    app.get('/', (_req, res) => {
      res
        .type('html')
        .send(
          '<h1 style="font-family:sans-serif">VINOH! Finanzas</h1><p style="font-family:sans-serif">Falta preparar la interfaz. Cerrá esta ventana y abrí el programa con el archivo <b>INICIAR</b> (hace todo solo), o corré <code>npm run build</code>.</p>',
        )
    })
  }

  app.use(errorHandler)
  return app
}
