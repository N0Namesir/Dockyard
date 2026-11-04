# Guía técnica de Dockyard

Esta guía es para el grupo que herede el proyecto. Explica cómo está dividido, cómo se arranca, cómo se despliega y por qué se tomaron las decisiones principales.

## Qué es y cómo se divide

Dockyard corre en la PC del docente y se usa desde su navegador, sin acceso desde internet ni login. Registra proyectos de estudiantes que traen su propio `docker compose`, y los enciende, apaga y abre.

```
navegador ──► web (Astro) ──► api (Fastify + SQLite) ──► core ──► git · unzip · docker compose ──► Docker del anfitrión
```

| Paquete | Hace | No hace nunca |
|---|---|---|
| `web/` | Muestra la lista, el formulario de registro y los botones | Calcular puertos o decidir estados |
| `api/` | Expone las rutas, guarda los proyectos en SQLite y llama al núcleo | Ejecutar docker, git o unzip por su cuenta |
| `core/` | Obtiene el código y controla los contenedores | Hablar HTTP, tocar la base de datos o dibujar pantallas |

## Estructura de carpetas

| Ruta | Contenido |
|---|---|
| `core/src/index.ts` | Contrato público del núcleo; la API importa solo desde aquí |
| `core/src/sources.ts` | `prepareProject`: clonado, descompresión, búsqueda del compose y limpieza |
| `core/src/docker.ts` | Encender, apagar, estado y detección de choques de puertos |
| `core/src/progress.ts` | Traduce la salida de `up -d` a etapas para el docente |
| `core/src/review.ts` | `reviewProject`: revisión del compose y de los archivos al registrar |
| `core/src/run.ts` | Ayudante que ejecuta comandos con `execFile` |
| `core/test/` | Pruebas unitarias e integración con Docker |
| `api/src/routes/projects.ts` | Rutas del contrato, validación y subida del ZIP a un archivo temporal |
| `api/src/services/projects.ts` | Une la base de datos con el núcleo; arma la respuesta de cada proyecto |
| `api/src/db/projects.ts` | Esquema de SQLite, consultas y búsqueda |
| `api/src/app.ts`, `api/src/server.ts` | Arma Fastify y sirve `web/dist` en el mismo puerto; arranca el servidor |
| `api/test/` | Pruebas de las rutas con un núcleo simulado |
| `web/src/pages/index.astro` | Página principal: lista, búsqueda, registro y botones, sin otro framework |
| `web/src/pages/docs/`, `web/src/lib/docs.ts` | Sección de documentación: publica `docs/*.md` en `/docs` al compilar |
| `web/public/` | Logo (`favicon.svg`), iconos generados a partir de él y emblema de la especialidad (`marca/`, fuera de la licencia MIT) |
| `web/src/styles/global.css` | Colores y fuentes de la identidad de DS3, en el bloque `@theme` |
| `ejemplos/` | Cuatro proyectos de prueba y el generador de ZIP de prueba |
| `projects/` | Código de los proyectos registrados (no se sube a git) |
| `data/` | Base de datos SQLite (no se sube a git) |

## Arrancar en desarrollo

Requisitos: Node 24 o superior, `docker`, `docker compose`, `git` y `unzip`.

```bash
npm install
npm run dev
```

El código TypeScript del núcleo corre directamente con Node 24 (type stripping) en pruebas y scripts, y se compila con `tsc` a `core/dist/` para producción. Por eso los imports relativos llevan extensión `.ts` y el código evita sintaxis que no se pueda borrar, como `enum` (lo exige `erasableSyntaxOnly` en `tsconfig.base.json`).

La API importa `@dockyard/core`, que apunta a `core/dist/`. Hay que compilar el núcleo una vez (`npm run build -w core`) o dejarlo en modo observación (`npm run dev -w core`).

## Desplegar en la PC del docente

```bash
./install.sh
```

El script comprueba Docker, crea `projects/` y `data/`, escribe `.env` y ejecuta `docker compose up -d --build`.

| Variable de `.env` | Uso |
|---|---|
| `PROJECTS_DIR` | Ruta absoluta de `projects/` en el anfitrión |
| `TOOL_PORT` | Puerto de la herramienta, 4300 por defecto |

Cómo funciona el contenedor:

- La herramienta usa el Docker del anfitrión a través de `/var/run/docker.sock`. Los proyectos de estudiantes no corren dentro de ella: son contenedores hermanos, así que sus puertos se publican en la PC y `http://localhost:<puerto>` funciona desde el navegador.
- **`projects/` se monta con la misma ruta dentro y fuera** (`${PROJECTS_DIR}:${PROJECTS_DIR}`). Cuando un proyecto monta una carpeta relativa (`./src:/app`), el Docker del anfitrión la resuelve con la ruta que ve la herramienta. Si las rutas difirieran, esos montajes apuntarían a un lugar que no existe.
- El contenedor corre con el usuario que ejecutó `install.sh` (`HOST_UID`, `HOST_GID`) y con el grupo del socket (`DOCKER_GID`), así que `projects/` y `data/` quedan a su nombre. Los contenedores de un proyecto pueden crear archivos de root en sus propias carpetas montadas; esos se borran con `sudo`.
- **Solo esta PC:** el puerto se publica en `127.0.0.1`, porque quien alcance la herramienta puede ejecutar cualquier compose con el Docker del anfitrión. Dentro del contenedor la API escucha en `0.0.0.0` (variable `HOST`); fuera, en `127.0.0.1`. Abrirla a la red exige agregar login antes.
- `restart: unless-stopped` hace que la herramienta vuelva sola al reiniciar, siempre que el servicio de Docker arranque con el sistema (`sudo systemctl enable docker`).

**Plan B, sin contenedor.** Si el despliegue en contenedor falla, la herramienta corre directamente en la PC con Node: `npm ci && npm run build && npm run start`, o con PM2 para que se mantenga encendida (`pm2 start npm --name dockyard -- run start`). Requiere Node 24, git, unzip y Docker en la PC.

## Cómo funcionan la API y la interfaz

- **Rutas:** las cinco de `/api/projects` responden JSON. Toda falla responde solo `{ "message": "…" }`: 400 por datos inválidos, 404 si no existe, 409 si el nombre se repite y 500 con el mensaje del núcleo.
- **El manejador de errores va antes de registrar las rutas** (`api/src/app.ts`). Un plugin hereda el manejador que existe al registrarse; si se define después, Fastify usa el suyo sin avisar.
- **Protección contra otras páginas:** el puerto local no basta, porque una página abierta en el navegador del docente también llega a `localhost`, incluidos los proyectos de estudiantes en otros puertos. Por eso `isAllowedRequest` (`api/src/app.ts`) exige un `Host` local y un `Origin` igual a `Host`, y responde 403 si no. Las peticiones sin `Origin`, como las de `curl`, se aceptan.
- **Enlaces:** `urls` trae uno por puerto. `url`, el del botón **Abrir**, es el primero que no sea de un servicio conocido que no es una página (como 3306 o 5432); si todos lo son, usa el primero. Es una suposición: por eso la columna **Puertos** enlaza todos.
- **Web:** `web` indica si contesta el puerto de **Abrir** (`api/src/services/web-check.ts`). Es `null` si el proyecto está apagado o solo publica puertos que no son páginas. Cualquier respuesta menor a 500 cuenta como `ok`, porque un 401 o un 404 también prueban que la aplicación está viva. La hace la API porque el núcleo no usa HTTP. Una web que contesta se vuelve a pedir cada minuto como mucho, para no gastar el límite de peticiones de los proyectos. Dentro del contenedor usa `PROJECTS_HOST` (`host.docker.internal`), porque ahí `localhost` es Dockyard.
- **Datos:** SQLite guarda solo lo que Docker no sabe (nombre, equipo, origen, carpeta). El estado y los puertos se consultan siempre al núcleo, así que listar ejecuta un `docker compose ps` por proyecto.
- **Búsqueda:** ignora mayúsculas y tildes con la función `normalizar`, registrada en SQLite, porque `LIKE` solo ignora mayúsculas en letras sin acento. `%` y `_` se buscan como texto.
- **ZIP:** se guarda en una carpeta temporal, con un límite de 200 MB, y se borra al terminar el registro, salga bien o mal.
- **Peticiones cortadas:** la ruta responde cuando el núcleo termina, hasta 10 minutos después. Firefox corta las peticiones pendientes cuando cambian las redes de la PC, y encender un proyecto crea una red de Docker (comprobado con Firefox 159; sin cambios de red, esperó 7 minutos sin problema). Por eso, si la petición se corta, la interfaz la repite, y la API la une a la operación en curso (`once` en `api/src/services/projects.ts`) en vez de lanzar otra. Así el docente recibe el resultado real, incluido el error.
- **Eliminar:** `DELETE /api/projects/:id` llama a `removeProject` y luego borra la fila. Si falla, la fila queda para poder reintentar. No se permite mientras el proyecto enciende o apaga (409).
- **Avance del encendido:** `GET /api/projects/:id/progress` devuelve `{ progress }`, con la etapa, las últimas 8 líneas de Docker y los segundos transcurridos, o `null` si no se está encendiendo. También llega en el campo `progress` de cada proyecto, para que recargar la página no lo pierda. Se guarda solo en memoria. La interfaz lo consulta cada 2 s.
- **Registro:** `GET /api/projects/:id/logs` devuelve las últimas 200 líneas. No es en vivo: se actualiza con un botón.
- **Documentación:** `docs/*.md` es la única fuente: Astro la convierte en páginas al compilar, así que un cambio se ve al reconstruir. Un documento nuevo se agrega a la lista de `web/src/lib/docs.ts`.
- **Refresco:** la interfaz consulta la lista cada 15 segundos y al volver a la pestaña, sin redibujar si nada cambió.
- **Búsqueda en la interfaz:** espera 300 ms desde la última tecla y descarta cualquier respuesta que no sea la de la última petición.

## Contrato entre el núcleo y la API

```ts
normalizeProjectName(name: string): string
prepareProject(source: ProjectSource, name: string): Promise<PreparedProject>   // { dir, name }
startProject(dir: string, name: string, onProgress?: (progress: StartProgress) => void): Promise<ProjectStatus>   // { state, ports }
stopProject(dir: string, name: string): Promise<ProjectStatus>
getProjectStatus(name: string): Promise<ProjectStatus>
reviewProject(dir: string, name: string): Promise<string[]>

type ProjectSource = { type: 'git'; url: string } | { type: 'zip'; filePath: string }
```

| Función | Qué hace | Falla cuando |
|---|---|---|
| `normalizeProjectName` | Convierte un nombre libre en uno válido para compose (`Álvarez & Co.` → `alvarez-co`) | Nunca; si no queda nada devuelve `proyecto` |
| `prepareProject` | Crea `projects/<nombre>`, obtiene el código, copia `.env.example` a `.env` y devuelve la carpeta del compose | La carpeta ya existe, la URL no es `https://`, el clonado o la descompresión fallan, o no hay compose |
| `startProject` | Revisa choques de puertos y ejecuta `up -d` | Un puerto está en uso, Docker no responde, el compose falla o los contenedores se caen al arrancar |
| `stopProject` | Ejecuta `stop` | Docker no responde |
| `getProjectStatus` | Lee `ps --format json` | Docker no responde |
| `reviewProject` | Devuelve avisos sobre el compose y los archivos, sin encender nada | Nunca por el contenido del proyecto; si algo no se pudo revisar, también lo avisa |

Reglas que cumple el núcleo:

- **Errores.** Toda falla es un `Error` con un mensaje en español que dice la causa y qué hacer. La API lo devuelve al docente tal cual.
- **Nombres.** `startProject`, `stopProject` y `getProjectStatus` rechazan nombres que no estén normalizados. La API debe guardar el `name` que devuelve `prepareProject`.
- **Conflictos antes de clonar.** La API puede llamar a `normalizeProjectName` antes de `prepareProject` para comprobar si el nombre ya existe en su base y responder 409 sin esperar un clonado.
- **ZIP.** El núcleo no borra el ZIP: lo creó la API, así que la API lo borra al terminar. Antes de extraerlo lee su lista de archivos y lo rechaza si una ruta sale de la carpeta, si trae más de 100 000 archivos o si ocuparía más de 3 GB.
- **Revisión al registrar.** `reviewProject` interpreta el compose con `config --format json` y recorre los archivos sin ejecutar nada. Avisa de lo que deja a un servicio salir de su contenedor (`privileged`, `network_mode: host`, permisos peligrosos, `docker.sock`, rutas de la PC), de enlaces que salen del proyecto, de archivos de credenciales o respaldos y de claves escritas en el código. Dice dónde está cada cosa y nunca incluye el valor. Los avisos se guardan en la columna `warnings` y no impiden encender, porque la decisión es del docente.
- **Comandos.** Todos se ejecutan con `execFile` y una lista de argumentos, nunca con una cadena para un shell.

### Cómo agregar una función nueva al núcleo

1. Escribe la función en el archivo de `core/src/` que corresponda, o en uno nuevo.
2. Ejecuta los comandos externos con `run` (de `run.ts`) y los de Docker con el ayudante `docker` de `docker.ts`, que traduce las fallas de conexión.
3. Exporta la función desde `core/src/index.ts`. Si cambia el contrato, acuérdalo con quien mantenga la API.
4. Agrega pruebas: puras en `core/test/unit.test.ts`; con Docker en `core/test/docker.test.ts`.

## Decisiones tomadas y por qué

| Decisión | Motivo |
|---|---|
| CLI de `docker compose` en lugar de la API de Docker | La API de Docker no maneja compose y dockerode-compose deja parte de la especificación sin implementar |
| `stop` en lugar de `down` para apagar | `stop` no borra contenedores ni redes, así encender de nuevo es rápido. `down` borra contenedores y redes (los volúmenes con nombre sí se conservan) |
| Avisar de un `container_name` repetido sin quitarlo | `stop` conserva los contenedores, así que el nombre sigue ocupado con el proyecto apagado. Quitarlo implicaría modificar el compose del equipo |
| Detectar choques de puertos sin reescribirlos | Los proyectos de estudiantes apuntan a sus propios puertos: un frontend que llama a `localhost:5000` dejaría de funcionar si se cambia el puerto del backend |
| `docker compose -p <nombre> ps` sin `-f` para el estado | No depende de la carpeta ni del archivo compose; se comprobó con Docker 29.9 y Compose 5.6 |
| Puerto 4300 para la herramienta | Los proyectos de estudiantes usan mucho el 3000, el 5173 y el 8080 |
| SQLite con `node:sqlite` | No requiere compilación nativa; con Node 24 funciona sin advertencias. Si fallara, `better-sqlite3` |
| Pruebas con `node:test` | Vienen con Node, sin dependencias |

## Pruebas

| Comando | Cubre |
|---|---|
| `npm test` | Sin Docker. Núcleo: normalización, lectura de la salida de Docker, detección de puertos y búsqueda del compose. API: rutas, errores, búsqueda y subida de ZIP con un núcleo simulado |
| `npm run test:docker -w core` | Los criterios de terminado del núcleo con Docker real: ZIP en la raíz y con carpeta intermedia, fallas sin carpetas a medias, choque de puertos, imagen con `build:`, persistencia de la base de datos y proyecto que se cae al arrancar |
| `npm run try -w core -- ejemplos/prueba-estatico` | Recorrido manual: preparar, consultar, encender, consultar, apagar, consultar |

GitHub Actions (`.github/workflows/ci.yml`) corre la compilación, los tipos y todas las pruebas, y construye la imagen, en cada push a `main` y en cada PR.

Las pruebas con Docker usan una carpeta temporal como `PROJECTS_DIR` y eliminan al final los contenedores y volúmenes que crearon. Necesitan libres los puertos 8081 a 8083.

## Límites conocidos y mejoras sugeridas

Esta entrega no las incluye. Mientras tanto, el docente registra solo proyectos que conozca.

- **La revisión al registrar no es una auditoría.** Busca patrones conocidos: no lee el código para entender lo que hace, ni lo que un Dockerfile o una imagen ejecutan al arrancar, y omite carpetas como `node_modules` y archivos de más de 1 MB. Un proyecto sin avisos no queda garantizado como seguro. Tampoco se repite después de registrar.
- **Repositorios privados**: hoy el clonado falla de inmediato (`GIT_TERMINAL_PROMPT=0`).
- **Reescritura automática de puertos o subdominios con Traefik**: Traefik da subdominios `.localhost`, pero exige saber qué servicio y qué puerto interno expone cada proyecto.
- **Límites de recursos** por proyecto.
- **Login** para el docente.
- La comprobación de la web no alcanza un puerto publicado solo en `127.0.0.1` (como `"127.0.0.1:8101:80"`) cuando Dockyard corre en contenedor: dirá que no responde aunque abra en el navegador. Tampoco entiende HTTPS.
- La detección de puertos solo ve contenedores. Si otro programa de la PC usa el puerto, falla `up -d` y el mensaje de Docker llega al docente.
- Actualizar un proyecto (`git pull`): el clonado conserva `.git` para poder hacerlo, pero falta la función.
