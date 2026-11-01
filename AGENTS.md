# AGENTS.md

Guía para agentes de código (Claude Code, Codex, etc.) que trabajan en este repositorio.

## Fuentes de verdad del diseño

- `referencias/Documento de visión ….md`: alcance, requisitos, stack, contrato de la API y reparto de áreas.
- `referencias/Ficha de 0V3R ….md`: detalle de las Áreas 1 y 4 (núcleo Docker, despliegue, pruebas, documentación) y criterios de terminado.
- `docs/guia-tecnica.md`: cómo quedó implementado y por qué.

Ante cualquier duda de diseño, consulta esos documentos antes de decidir. Si el código y la ficha discrepan, pregunta.

## Comandos

```bash
npm install                                   # Node 24 o superior
npm run build                                 # compila core, api y web
npm run typecheck
npm test                                      # pruebas del núcleo sin Docker
npm run test:docker -w core                   # pruebas con Docker real (usan los puertos 8081-8083, ~1-2 min)
node --test --test-name-pattern="choque" core/test/docker.test.ts   # una sola prueba
npm run try -w core -- ejemplos/prueba-estatico   # recorrido manual (url https, .zip o carpeta)
node ejemplos/crear-zips.ts                   # genera las variantes de ZIP en ejemplos/zips/
./install.sh                                  # despliegue en contenedor
```

Los `.ts` corren directamente con Node 24 (type stripping) y `tsc` (TypeScript 7) solo compila a `dist/`. Por eso los imports relativos llevan extensión `.ts` y no se usa sintaxis no borrable (`enum`, `namespace`, parámetros de propiedad); lo hacen cumplir `erasableSyntaxOnly` y `rewriteRelativeImportExtensions` en `tsconfig.base.json`. `@dockyard/core` exporta desde `core/dist/`, así que la API necesita `npm run build -w core` (o `npm run dev -w core`) antes de importarlo.

## Qué es Dockyard

Aplicación web local que corre en la PC del docente (Ubuntu, sin exposición a internet, sin login). Permite registrar proyectos de estudiantes desde un repositorio de GitHub (solo `https://`, solo públicos) o un ZIP, y encenderlos, apagarlos y abrirlos. Cada proyecto trae su propio `docker-compose`. Prioridades, en orden: que funcione en la entrega y que la estructura sea clara para el grupo que la herede.

## Arquitectura

Monorepo con workspaces de npm (`core`, `api`, `web`) y un `tsconfig.base.json` compartido. `api/` y `web/` son stubs hasta que Isaac los implemente. Las carpetas tienen dueño y fronteras estrictas:

| Carpeta | Área | Responsable | Frontera |
|---|---|---|---|
| `core/` | 1: núcleo Docker y fuentes | 0V3R | Solo ejecuta `git`, `unzip` y `docker compose`. Nunca HTTP, SQLite ni UI |
| `api/` | 2: API y datos | Isaac | Fastify 5 + TypeBox + SQLite (`node:sqlite`, con `better-sqlite3` como respaldo). Orquesta llamando a `core/`, nunca ejecuta Docker ni git |
| `web/` | 3: interfaz | Isaac | Astro + Tailwind. Solo habla con la API, sin lógica de estados ni puertos |
| `docs/`, `Dockerfile`, `docker-compose.yml`, `install.sh` | 4: infraestructura y documentación | 0V3R | No escribe lógica de otras áreas |
| `projects/`, `data/` | — | — | Datos de ejecución, en `.gitignore` |

No modifiques `api/` ni `web/` (ni `core/` desde la otra área) sin avisar al responsable. Las firmas del contrato no cambian sin acuerdo entre los dos.

### Contrato de `core/`

```ts
normalizeProjectName(name: string): string
prepareProject(source: ProjectSource, name: string): Promise<PreparedProject>   // { dir, name }
startProject(dir: string, name: string): Promise<ProjectStatus>                 // { state, ports }
stopProject(dir: string, name: string): Promise<ProjectStatus>
getProjectStatus(name: string): Promise<ProjectStatus>
// ProjectSource = { type: 'git'; url } | { type: 'zip'; filePath }
```

- Toda falla se lanza como `Error` con un mensaje en español que dice la causa y qué hacer. La API se lo devuelve tal cual al docente.
- Los comandos se ejecutan siempre con `execFile` y una lista de argumentos, mediante un ayudante `run` común (con `GIT_TERMINAL_PROMPT=0`). Nunca se arma una cadena para un shell.
- Todos los comandos de compose usan el prefijo `docker compose -p <nombre> --project-directory <dir> -f <dir>/<archivo>`. `getProjectStatus` usa solo `-p`.
- El compose se busca en este orden: `compose.yaml`, `compose.yml`, `docker-compose.yaml`, `docker-compose.yml`, primero en la raíz y luego en una única subcarpeta.
- Apagar es `stop`, no `down`.
- Los choques de puertos se detectan antes de `up -d` (con `config --format json` contra `docker ps`) y se avisan. Los puertos nunca se reescriben.
- Si `prepareProject` falla a mitad de camino, borra la carpeta que creó. El ZIP lo borra la API, no el núcleo.
- `startProject`, `stopProject` y `getProjectStatus` rechazan nombres sin normalizar (`assertNormalizedName`).
- Los comandos de Docker pasan por el ayudante `docker()` de `core/src/docker.ts`, que traduce "Docker no responde" y "sin permiso". Los demás, por `run()` de `core/src/run.ts`.

### Rutas de la API (contrato con `web/`)

`GET /api/projects?q=`, `POST /api/projects`, `GET /api/projects/:id`, `POST /api/projects/:id/start`, `POST /api/projects/:id/stop`.

## Despliegue

- La herramienta corre en un contenedor que usa el Docker del anfitrión por `/var/run/docker.sock`. Los proyectos de estudiantes son contenedores hermanos, así que sus puertos se publican en la PC del docente.
- **Regla crítica:** `projects/` se monta con la misma ruta dentro y fuera del contenedor (`${PROJECTS_DIR}:${PROJECTS_DIR}`). Si no, los bind mounts relativos de los proyectos se rompen.
- El puerto de la herramienta es poco común (por defecto `4300`, variable `TOOL_PORT`) para no chocar con 3000, 5173 u 8080.
- `install.sh` genera `.env` (`PROJECTS_DIR`, `TOOL_PORT`) y ejecuta `docker compose up -d --build`.
- En desarrollo no se usa el contenedor: `npm run dev` contra el Docker local. Requiere `docker`, `docker compose`, `git` y `unzip`.
- Plan B: correr con Node y PM2 directamente en la PC.

## Pruebas

Se usa `node:test`, sin dependencias. `core/test/unit.test.ts` cubre las funciones puras; `core/test/docker.test.ts` cubre los criterios de terminado de la ficha con Docker real, usando un `PROJECTS_DIR` temporal y nombres `dockyard-test-*` que elimina al terminar (`down -v`). Los proyectos de prueba están en `ejemplos/`: `prueba-estatico` (8081, monta `./html` con ruta relativa), `prueba-bd` (8082, con `.env.example`), `prueba-build` (8083) y `prueba-conflicto` (8081, para el choque de puertos).

## Convenciones

- Código, mensajes de error y documentación en español.
- Flujo de git: una rama por persona y cambios pequeños. La rama principal es `main`.
- Commits y PRs sin atribución de agentes: nada de `Co-Authored-By`, "Generated with …", enlaces de sesión ni líneas similares. Solo el mensaje del cambio. Antes de cada commit o push, revisa el mensaje (`git log -1 --format=%B`) y quita cualquier línea de ese tipo.
