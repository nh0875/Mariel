// Protección de la API contra páginas web de afuera.
//
// El servidor escucha solo en esta computadora (127.0.0.1), pero el navegador de la persona
// sí visita otras páginas. Sin esta protección, cualquier página abierta podría:
// - mandar un formulario o un fetch "simple" (sin preflight) a http://127.0.0.1:3030/api/... y
//   borrar todo, cargar el ejemplo o restaurar otra base (CSRF);
// - con un DNS que apunta a 127.0.0.1 ("DNS rebinding") leer las respuestas de la API como si
//   fueran de su propio dominio.
//
// Dos reglas simples lo cortan:
// 1. Host: solo se aceptan pedidos dirigidos a localhost / 127.0.0.1 / [::1] (cualquier puerto).
//    El proxy de Vite en desarrollo usa changeOrigin, así que llega como 127.0.0.1:PUERTO.
// 2. Todo lo que no sea leer (POST, PUT, PATCH, DELETE…) tiene que traer el encabezado
//    `X-VINOH: 1`. Un navegador no puede mandar un encabezado propio a otro sitio sin preguntar
//    antes (preflight CORS), y esta API nunca contesta que sí a esas preguntas. Las pantallas del
//    programa lo mandan siempre (client/src/lib/api.ts). Las descargas son GET y no lo necesitan.
import type { RequestHandler } from 'express'

export const WRITE_HEADER = 'x-vinoh'
export const WRITE_HEADER_VALUE = '1'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/** Nombre del host sin el puerto ("localhost:3030" → "localhost", "[::1]:3030" → "[::1]"). */
export function hostName(host: string): string {
  const h = host.trim().toLowerCase()
  if (h.startsWith('[')) {
    const end = h.indexOf(']')
    return end >= 0 ? h.slice(0, end + 1) : h
  }
  const colon = h.indexOf(':')
  return colon >= 0 ? h.slice(0, colon) : h
}

export function isLocalHost(host: string | undefined): boolean {
  if (!host) return false
  return LOCAL_HOSTS.has(hostName(host))
}

const READ_METHODS = new Set(['GET', 'HEAD'])

export const HOST_MSG =
  'Por seguridad, VINOH! solo responde cuando lo abrís desde esta computadora (http://localhost:3030). Abrilo con el archivo INICIAR o escribí esa dirección en el navegador.'
export const WRITE_MSG =
  'Por seguridad, VINOH! solo acepta cambios hechos desde sus propias pantallas. Si estás usando el programa y ves esto, recargá la página (F5) y probá de nuevo.'

/** Middleware para /api: corta pedidos de otros sitios (ver arriba). */
export function localOnly(): RequestHandler {
  return (req, res, next) => {
    if (!isLocalHost(req.headers.host)) {
      res.status(403).json({ error: HOST_MSG })
      return
    }
    if (!READ_METHODS.has(req.method)) {
      // OPTIONS incluido: nunca contestamos preflights, así un sitio de afuera no puede
      // "pedir permiso" para mandar el encabezado.
      if (req.method === 'OPTIONS' || req.get(WRITE_HEADER) !== WRITE_HEADER_VALUE) {
        res.status(403).json({ error: WRITE_MSG })
        return
      }
    }
    next()
  }
}
