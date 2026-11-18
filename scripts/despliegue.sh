# Pasos comunes de install.sh y update.sh. No se ejecuta solo: lo cargan esos dos scripts.

fail() {
  echo "✘ $*" >&2
  exit 1
}

# El contenedor corre con el usuario que ejecuta el script: con sudo quedaría como root.
rechazar_root() {
  if [[ "$(id -u)" == 0 ]]; then
    fail "No ejecutes este script con sudo ni como root: ejecútalo con tu usuario, que debe estar en el grupo docker."
  fi
}

version_actual() {
  sed -n 's/^  "version": "\(.*\)",$/\1/p' package.json
}

comprobar_docker() {
  command -v docker >/dev/null || fail "No se encontró docker. Instálalo con https://docs.docker.com/engine/install/ubuntu/"
  docker compose version >/dev/null 2>&1 || fail "No se encontró el complemento docker compose (paquete docker-compose-plugin)."
  docker info >/dev/null 2>&1 || fail "Docker no responde o no hay permiso para usarlo. Enciende el servicio (sudo systemctl start docker) o agrega tu usuario al grupo docker (sudo usermod -aG docker \$USER) y vuelve a iniciar sesión."
  echo "Docker:  $(docker version --format '{{.Server.Version}}')"
  echo "Compose: $(docker compose version --short)"
}

preparar_carpetas() {
  mkdir -p projects data
  # Una instalación anterior pudo dejar estas carpetas a nombre de root.
  if [[ -n "$(find projects data -maxdepth 1 -not -user "$(id -u)" -print -quit)" ]]; then
    fail "Hay archivos en projects/ o data/ de otro usuario. Corrígelo con: sudo chown -R \$(id -u):\$(id -g) projects data"
  fi
}

# Escribe .env. Conserva el puerto y la consulta de versiones de una instalación anterior, salvo
# que se indiquen otros (TOOL_PORT=4400 ./update.sh): quien los cambió no debe perderlos al actualizar.
escribir_env() {
  if [[ -z "${TOOL_PORT:-}" && -f .env ]]; then
    TOOL_PORT="$(sed -n 's/^TOOL_PORT=//p' .env)"
  fi
  TOOL_PORT="${TOOL_PORT:-4300}"
  if [[ -z "${UPDATE_CHECK:-}" && -f .env ]]; then
    UPDATE_CHECK="$(sed -n 's/^UPDATE_CHECK=//p' .env)"
  fi
  UPDATE_CHECK="${UPDATE_CHECK:-on}"

  cat > .env <<ENV
# Generado por install.sh y update.sh
PROJECTS_DIR=$(pwd)/projects
TOOL_PORT=${TOOL_PORT}
UPDATE_CHECK=${UPDATE_CHECK}
HOST_UID=$(id -u)
HOST_GID=$(id -g)
DOCKER_GID=$(stat -c %g /var/run/docker.sock)
ENV
}

# Construye la imagen, levanta el contenedor y espera a que la página responda.
levantar_y_esperar() {
  docker compose up -d --build

  echo
  if ! command -v curl >/dev/null; then
    echo "✔ Dockyard se levantó. Ábrelo en http://localhost:${TOOL_PORT} (instala curl para que este script compruebe que responde)."
    return
  fi
  echo "Esperando a que Dockyard responda en el puerto ${TOOL_PORT}..."
  for _ in $(seq 1 30); do
    if curl -fsS -o /dev/null "http://localhost:${TOOL_PORT}" 2>/dev/null; then
      echo "✔ Dockyard $(version_actual) está disponible en http://localhost:${TOOL_PORT}"
      return
    fi
    sleep 1
  done
  fail "Dockyard no responde en http://localhost:${TOOL_PORT}. Revisa el registro con: docker compose logs app"
}
