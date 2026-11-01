# AGENTS.md

Guía para agentes de código (Claude Code, Codex, etc.) que trabajan en este repositorio.

## Estado del repositorio

Todavía no hay código: solo el commit inicial y `referencias/`, que contiene la fuente de verdad del diseño:

- `referencias/Documento de visión ….md`: alcance, requisitos, stack, contrato de la API y reparto de áreas.
- `referencias/Ficha de 0V3R ….md`: detalle de las Áreas 1 y 4 (núcleo Docker, despliegue, pruebas, documentación) y criterios de terminado.

Ante cualquier duda de diseño, consulta esos dos documentos antes de decidir. Si el código y la ficha discrepan, pregunta.

## Qué es Dockyard

Aplicación web local que corre en la PC del docente (Ubuntu, sin exposición a internet, sin login). Permite registrar proyectos de estudiantes desde un repositorio de GitHub (solo `https://`, solo públicos) o un ZIP, y encenderlos, apagarlos y abrirlos. Cada proyecto trae su propio `docker-compose`. Prioridades, en orden: que funcione en la entrega y que la estructura sea clara para el grupo que la herede.

## Arquitectura (planificada)

Monorepo con workspaces de npm, un `tsconfig` base compartido y scripts raíz `dev`, `build` y `start`. Las carpetas tienen dueño y fronteras estrictas:

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

No hay framework de pruebas definido. El núcleo se prueba con un script manual (`core/try.ts`) que ejecuta `prepare → status → start → status → stop → status` sobre los proyectos de prueba `prueba-estatico` (8081), `prueba-bd` (8082), `prueba-build` (8083) y `prueba-conflicto` (8081, para probar el choque de puertos). Los criterios de terminado están al final de la ficha de 0V3R.

## Convenciones

- Código, mensajes de error y documentación en español.
- Flujo de git: una rama por persona y cambios pequeños. La rama principal es `main`.
- Commits y PRs sin atribución de agentes: nada de `Co-Authored-By`, "Generated with …", enlaces de sesión ni líneas similares. Solo el mensaje del cambio. Antes de cada commit o push, revisa el mensaje (`git log -1 --format=%B`) y quita cualquier línea de ese tipo.
