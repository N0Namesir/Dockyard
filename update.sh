#!/usr/bin/env bash
# Actualiza Dockyard a la última versión publicada y lo vuelve a levantar. También sirve si la
# página dejó de cargar: aunque no haya versión nueva, reconstruye y levanta el contenedor.
# Los proyectos registrados y sus datos se conservan, y los encendidos siguen encendidos.
#
#   ./update.sh                   conserva el puerto y la configuración actuales
#   TOOL_PORT=4400 ./update.sh    cambia el puerto
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"
source scripts/despliegue.sh

# Primera parte: trae la versión nueva. git pull puede cambiar este mismo archivo, así que la
# segunda parte la ejecuta el update.sh nuevo (exec), con los pasos de la versión que se instala.
descargar() {
  rechazar_root
  if [[ ! -f .env ]]; then
    fail "Dockyard aún no está instalado en esta carpeta. Para instalarlo, ejecuta: ./install.sh"
  fi
  comprobar_docker

  git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
    || fail "Esta carpeta no es una copia de git de Dockyard. Vuelve a clonarla con: git clone https://github.com/N0Namesir/Dockyard.git"
  git symbolic-ref -q HEAD >/dev/null \
    || fail "La copia de Dockyard no está en una rama. Vuelve a la principal con: git checkout main"
  git rev-parse -q --verify '@{upstream}' >/dev/null 2>&1 \
    || fail "La rama actual de Dockyard no sigue a la de GitHub. Vuelve a la principal con: git checkout main"
  local cambios
  cambios="$(git status --porcelain --untracked-files=no)"
  if [[ -n "$cambios" ]]; then
    fail "Hay archivos de Dockyard modificados en esta PC, así que no se actualizó nada:
${cambios}
Guárdalos aparte con: git stash   y vuelve a ejecutar ./update.sh"
  fi

  local antes
  antes="$(version_actual)"
  echo "Buscando una versión nueva (tienes la ${antes})..."
  git fetch --quiet \
    || fail "No se pudo descargar la versión nueva. Revisa la conexión a internet y vuelve a intentarlo. Dockyard sigue funcionando con la versión ${antes}."
  # Solo avanza: nunca mezcla con cambios propios de esta copia.
  git merge --ff-only --quiet '@{upstream}' 2>/dev/null \
    || fail "Esta copia de Dockyard tiene commits propios que no están en GitHub, así que no se actualizó nada. Pide ayuda a quien mantiene Dockyard. Sigue funcionando con la versión ${antes}."
  exec ./update.sh --levantar "$antes"
}

# Segunda parte: con el código ya actualizado, reconstruye y levanta.
levantar() {
  local antes="$1" ahora
  ahora="$(version_actual)"
  if [[ "$antes" == "$ahora" ]]; then
    echo "Ya tenías la última versión (${ahora}). Se vuelve a levantar Dockyard."
  else
    echo "Se descargó la versión ${ahora} (tenías la ${antes}). Se reconstruye Dockyard; tarda unos minutos."
  fi
  preparar_carpetas
  escribir_env
  levantar_y_esperar
}

main() {
  if [[ "${1:-}" == "--levantar" ]]; then
    levantar "${2:?}"
  else
    descargar
  fi
}

main "$@"
