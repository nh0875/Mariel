#!/bin/bash
# Doble clic para abrir VINOH! Finanzas en Mac.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Para usar VINOH! Finanzas hace falta instalar Node.js (es gratis)."
  echo "  Te abro la página: descargá la versión LTS, instalala y volvé a abrir este archivo."
  echo ""
  open "https://nodejs.org/es/download"
  read -r -p "  Presioná Enter para cerrar…"
  exit 1
fi
node scripts/iniciar.mjs
