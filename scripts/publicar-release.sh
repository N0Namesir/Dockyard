#!/usr/bin/env bash
# Crea en GitHub el release de la versión actual de package.json. Lo llama `npm version` después de
# subir el commit y la etiqueta. Las notas son los commits desde la versión anterior.
#
#   scripts/publicar-release.sh            crea el release de la versión actual
#   scripts/publicar-release.sh --revisar  solo comprueba que gh esté listo (lo usa preversion)
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")/.."

if ! command -v gh >/dev/null 2>&1; then
  echo "Falta la herramienta gh de GitHub, necesaria para crear el release. Instálala y ejecuta: gh auth login" >&2
  exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "gh no tiene sesión iniciada en GitHub. Ejecuta: gh auth login" >&2
  exit 1
fi
[[ "${1:-}" == "--revisar" ]] && exit 0

version="v$(node -p "require('./package.json').version")"
git rev-parse -q --verify "refs/tags/${version}" >/dev/null \
  || { echo "No existe la etiqueta ${version}. Publica la versión con: npm version" >&2; exit 1; }
anterior="$(git describe --tags --abbrev=0 --match 'v[0-9]*.[0-9]*.[0-9]*' "${version}^" 2>/dev/null || true)"
rango="${anterior:+${anterior}..}${version}"
# Sin el commit "Versión X.Y.Z" que crea npm version.
cambios="$(git log --no-merges --format='- %s' "$rango" | grep -v '^- Versión [0-9]' || true)"
[[ -n "$cambios" ]] || cambios="- Sin cambios de código."

notas="$(cat <<NOTAS
## Cambios

${cambios}

## Actualizar

En la carpeta de Dockyard:

\`\`\`bash
./update.sh
\`\`\`
NOTAS
)"

gh release create "$version" --title "Dockyard ${version}" --notes "$notas" --verify-tag --latest
