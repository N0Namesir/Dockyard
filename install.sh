#!/usr/bin/env bash
# Instala Dockyard en esta PC. Se usa una sola vez, después de clonar el repositorio.
# Para actualizarlo, o si la página dejó de cargar, usa ./update.sh.
#
#   ./install.sh                  puerto por defecto (4300)
#   TOOL_PORT=4400 ./install.sh   otro puerto
#   UPDATE_CHECK=off ./install.sh sin consultar versiones nuevas
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"
source scripts/despliegue.sh

main() {
  rechazar_root
  if [[ -f .env ]]; then
    fail "Dockyard ya está instalado en esta carpeta. Para actualizarlo, o si la página no carga, ejecuta: ./update.sh"
  fi
  comprobar_docker
  preparar_carpetas
  escribir_env
  levantar_y_esperar
  echo "Para instalar versiones nuevas más adelante, ejecuta ./update.sh en esta carpeta."
}

main "$@"
