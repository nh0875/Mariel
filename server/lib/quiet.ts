// node:sqlite todavía figura como "experimental" en Node 22/24 y muestra un aviso
// al arrancar. Funciona perfecto; silenciamos solo ese aviso para no asustar a nadie.
// Este archivo tiene que importarse ANTES que cualquier cosa que use node:sqlite.
const originalEmitWarning = process.emitWarning.bind(process)
process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
  const text = typeof warning === 'string' ? warning : warning?.message
  if (text && text.includes('SQLite is an experimental feature')) return
  return (originalEmitWarning as (...a: unknown[]) => void)(warning, ...args)
}) as typeof process.emitWarning
