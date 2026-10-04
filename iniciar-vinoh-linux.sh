#!/bin/bash
# Abrir VINOH! Finanzas en Linux: ./iniciar-vinoh-linux.sh
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Hace falta Node.js 22.13 o más nuevo: https://nodejs.org/es/download"
  xdg-open "https://nodejs.org/es/download" >/dev/null 2>&1 || true
  exit 1
fi
node scripts/iniciar.mjs
