#!/usr/bin/env bash
# Instala y levanta Dockyard en esta máquina. Se puede volver a ejecutar para actualizar.
#
#   ./install.sh              puerto por defecto (4300)
#   TOOL_PORT=4400 ./install.sh
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

fail() {
  echo "✘ $*" >&2
  exit 1
}

command -v docker >/dev/null || fail "No se encontró docker. Instálalo con https://docs.docker.com/engine/install/ubuntu/"
docker compose version >/dev/null 2>&1 || fail "No se encontró el complemento docker compose (paquete docker-compose-plugin)."
docker info >/dev/null 2>&1 || fail "Docker no responde o no hay permiso para usarlo. Enciende el servicio (sudo systemctl start docker) o agrega tu usuario al grupo docker (sudo usermod -aG docker \$USER) y vuelve a iniciar sesión."

echo "Docker:  $(docker version --format '{{.Server.Version}}')"
echo "Compose: $(docker compose version --short)"

mkdir -p projects data

# Una instalación anterior pudo dejar estas carpetas a nombre de root.
if [[ -n "$(find projects data -maxdepth 1 -not -user "$(id -u)" -print -quit)" ]]; then
  fail "Hay archivos en projects/ o data/ de otro usuario. Corrígelo con: sudo chown -R \$(id -u):\$(id -g) projects data"
fi

# Conserva el puerto de una instalación anterior si no se indica otro.
if [[ -z "${TOOL_PORT:-}" && -f .env ]]; then
  TOOL_PORT="$(sed -n 's/^TOOL_PORT=//p' .env)"
fi
TOOL_PORT="${TOOL_PORT:-4300}"

cat > .env <<EOF
# Generado por install.sh
PROJECTS_DIR=$(pwd)/projects
TOOL_PORT=${TOOL_PORT}
HOST_UID=$(id -u)
HOST_GID=$(id -g)
DOCKER_GID=$(stat -c %g /var/run/docker.sock)
EOF

docker compose up -d --build

echo
if ! command -v curl >/dev/null; then
  echo "✔ Dockyard se levantó. Ábrelo en http://localhost:${TOOL_PORT} (instala curl para que este script compruebe que responde)."
  exit 0
fi
echo "Esperando a que Dockyard responda en el puerto ${TOOL_PORT}..."
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://localhost:${TOOL_PORT}" 2>/dev/null; then
    echo "✔ Dockyard está disponible en http://localhost:${TOOL_PORT}"
    exit 0
  fi
  sleep 1
done
fail "Dockyard no responde en http://localhost:${TOOL_PORT}. Revisa el registro con: docker compose logs app"
