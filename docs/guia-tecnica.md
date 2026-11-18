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
| `core/src/sources.ts` | `prepareProject`, `updateProject` y `replaceProjectZip`: clonado, actualización, descompresión, reemplazo del ZIP, búsqueda del compose y limpieza |
| `core/src/docker.ts` | Encender, apagar, estado, reiniciar datos, eliminar, renombrar y detección de choques de puertos |
| `core/src/resources.ts` | Consumo de CPU y memoria por proyecto, a partir de `docker stats` |
| `core/src/disk.ts` | Espacio en disco por proyecto y borrado de sus versiones viejas de imágenes |
| `core/src/progress.ts` | Traduce la salida de `up -d` a etapas para el docente |
| `core/src/review.ts` | `reviewProject`: revisión del compose y de los archivos al registrar |
| `core/src/run.ts` | Ayudante que ejecuta comandos con `execFile` |
| `core/test/` | Pruebas unitarias e integración con Docker |
| `api/src/routes/projects.ts` | Rutas del contrato, validación y subida del ZIP a un archivo temporal |
| `api/src/services/projects.ts` | Une la base de datos con el núcleo; arma la respuesta de cada proyecto |
| `api/src/services/disk.ts`, `api/src/routes/disk.ts` | Espacio en disco de los proyectos registrados y su limpieza |
| `api/src/db/projects.ts` | Esquema de SQLite, consultas y búsqueda |
| `api/src/services/images.ts` | Imágenes de los proyectos en `data/imagenes/`: tipo por la firma de bytes, guardar, leer y borrar |
| `api/src/app.ts`, `api/src/server.ts` | Arma Fastify y sirve `web/dist` en el mismo puerto; arranca el servidor |
| `api/test/` | Pruebas de las rutas con un núcleo simulado |
| `web/src/pages/index.astro` | Página principal: solo el HTML fijo (tabla, formulario y diálogo). Carga `src/scripts/projects/main.ts` |
| `web/src/scripts/projects/` | Lógica de la página en TypeScript, sin otro framework. Un módulo por tarea (ver abajo) |
| `web/src/pages/proyecto.astro`, `web/src/scripts/project/` | Ficha de un proyecto (`/proyecto/?id=<id>`): `main.ts` carga y enciende o apaga, `view.ts` la dibuja, `edit-form.ts` y `contacts.ts` la editan, `dom.ts` tiene sus elementos fijos |
| `web/src/pages/docs/`, `web/src/lib/docs.ts` | Sección de documentación: publica `docs/*.md` en `/docs` al compilar |
| `web/public/` | Logo (`favicon.svg`), iconos generados a partir de él y emblema de la especialidad (`marca/`, fuera de la licencia MIT) |
| `web/src/styles/global.css` | Colores y fuentes de la identidad de DS3, en el bloque `@theme` |
| `ejemplos/` | Cuatro proyectos de prueba y el generador de ZIP de prueba |
| `projects/` | Código de los proyectos registrados (no se sube a git) |
| `data/` | Base de datos SQLite (no se sube a git) |

### Módulos de la interfaz

`web/src/scripts/projects/` separa la página en módulos pequeños. Las dependencias van en una sola dirección, sin ciclos: los de la base no importan nada propio, las filas no conocen las acciones y solo `main.ts` conecta todo.

| Módulo | Qué hace |
|---|---|
| `types.ts` | Forma de las respuestas de la API y `RowHandlers`, las acciones que reciben las filas |
| `api.ts` | Única puerta hacia la API: errores con mensaje para el docente y reintentos cuando Firefox corta la petición |
| `dom.ts`, `format.ts` | Elementos fijos de la página, mensaje general y textos de CPU, memoria y tiempo |
| `state.ts` | Copia de la lista y lo que el docente tiene abierto (registros, avisos, acciones en curso). La API sigue siendo la fuente de verdad |
| `table.ts` | Dibuja la lista a partir del estado, en tabla o en cuadrícula, y conserva el foco y los menús abiertos al refrescar |
| `parts/` | Piezas que comparten la fila y la tarjeta: nombre e imagen (`identity.ts`), estado (`status.ts`), puertos (`ports.ts`) y botones con el menú ⋯ (`controls.ts`) |
| `cards/` | Tarjeta de un proyecto y de un registro en curso, para la cuadrícula |
| `folders.ts`, `view-toggle.ts` | Carpetas por año (`?año=` en la URL) y selector Tabla \| Cuadrícula, que guarda la preferencia en la API |
| `rows/` | Una fila por archivo: proyecto, avance del encendido, avisos, registro y registro en curso. El avance, los avisos y el registro se arman como paneles (`progressPanel`, `warningsPanel`, `logsPanel`) que la tarjeta también usa |
| `list.ts`, `progress.ts`, `logs.ts`, `resources.ts`, `version.ts`, `registrations.ts` | Cargar la lista y consultar cada cierto tiempo el avance, el registro, el consumo, la versión y los proyectos que se están registrando |
| `run-action.ts`, `actions.ts`, `stop-all.ts`, `replace-zip.ts` | Marcar la acción en curso y su error; encender, apagar, apagar el que choca, actualizar, reiniciar datos y eliminar; apagar todos; reemplazar el ZIP |
| `element.ts`, `avatar.ts` | Crear elementos e imagen del proyecto (o su inicial sobre un color de la marca). No dependen de la página: los usan también la ficha y Configuración |
| `batch/` | Pestaña **Varios** del registro: pestañas (`tabs.ts`), lectura de las líneas (`parse.ts`), lista de GitHub (`git.ts`) y varios ZIP (`zip.ts`) |
| `remove-dialog.ts`, `confirm-dialog.ts`, `register-form.ts` | Confirmación escribiendo el nombre para lo que no se puede deshacer (eliminar, reiniciar datos, reemplazar el ZIP) y de un clic para lo demás; formulario de registro |
| `main.ts` | Conecta las acciones con la tabla, el buscador y los intervalos de refresco |

Para agregar un botón a un proyecto: la acción va en `actions.ts`, el botón en `parts/controls.ts` (así aparece en la fila y en la tarjeta), y se conectan en `RowHandlers` y en `main.ts`. Como es TypeScript normal, `npm run typecheck` revisa también este código, cosa que no hacía mientras estaba dentro del `.astro`. Las clases de Tailwind escritas aquí se generan igual que las del `.astro`.

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
./install.sh    # solo la primera vez
./update.sh     # para actualizar, o si la página dejó de cargar
```

Los dos comprueban Docker, crean `projects/` y `data/`, escriben `.env` y ejecutan `docker compose up -d --build`, con los pasos comunes en `scripts/despliegue.sh`. Se separaron para que el docente no dude cuál usar:

- `install.sh` se niega a correr si ya existe `.env`, y remite a `update.sh`.
- `update.sh` se niega si no existe `.env`, y remite a `install.sh`. Antes de tocar nada exige una copia de git sin archivos modificados, en una rama que siga a la de GitHub. Hace `git fetch` y `git merge --ff-only`: nunca mezcla, así que una copia con commits propios no se actualiza y lo dice. Después se vuelve a ejecutar con `exec`, porque la descarga pudo cambiar el propio `update.sh` y bash lee los scripts mientras los ejecuta; así la reconstrucción la hace el script de la versión descargada. Aunque no haya versión nueva, reconstruye y levanta: sirve también cuando la página no carga.
- Los dos rechazan `sudo`, porque el contenedor corre con el usuario que ejecuta el script y quedaría como root.

| Variable de `.env` | Uso |
|---|---|
| `PROJECTS_DIR` | Ruta absoluta de `projects/` en el anfitrión |
| `TOOL_PORT` | Puerto de la herramienta, 4300 por defecto |
| `UPDATE_CHECK` | Valor inicial de la consulta automática de versiones nuevas (`off` la apaga; `on` por defecto) hasta que el docente la cambie en Configuración. `update.sh` conserva el valor, igual que `TOOL_PORT` |

Cómo funciona el contenedor:

- La herramienta usa el Docker del anfitrión a través de `/var/run/docker.sock`. Los proyectos de estudiantes no corren dentro de ella: son contenedores hermanos, así que sus puertos se publican en la PC y `http://localhost:<puerto>` funciona desde el navegador.
- **`projects/` se monta con la misma ruta dentro y fuera** (`${PROJECTS_DIR}:${PROJECTS_DIR}`). Cuando un proyecto monta una carpeta relativa (`./src:/app`), el Docker del anfitrión la resuelve con la ruta que ve la herramienta. Si las rutas difirieran, esos montajes apuntarían a un lugar que no existe.
- El contenedor corre con el usuario que ejecutó `install.sh` o `update.sh` (`HOST_UID`, `HOST_GID`) y con el grupo del socket (`DOCKER_GID`), así que `projects/` y `data/` quedan a su nombre. Los contenedores de un proyecto pueden crear archivos de root en sus propias carpetas montadas; esos se borran con `sudo`.
- **Solo esta PC:** el puerto se publica en `127.0.0.1`, porque quien alcance la herramienta puede ejecutar cualquier compose con el Docker del anfitrión. Dentro del contenedor la API escucha en `0.0.0.0` (variable `HOST`); fuera, en `127.0.0.1`. Abrirla a la red exige agregar login antes.
- `restart: unless-stopped` hace que la herramienta vuelva sola al reiniciar, siempre que el servicio de Docker arranque con el sistema (`sudo systemctl enable docker`).

**Plan B, sin contenedor.** Si el despliegue en contenedor falla, la herramienta corre directamente en la PC con Node: `npm ci && npm run build && npm run start`, o con PM2 para que se mantenga encendida (`pm2 start npm --name dockyard -- run start`). Requiere Node 24, git, unzip y Docker en la PC.

## Publicar una versión

En `main`, con el árbol limpio:

```bash
npm version 1.1.0     # o patch, minor, major
```

Ese comando comprueba que estás en `main` y que `gh` tiene sesión en GitHub, compila y corre los tipos y las pruebas sin Docker. Si pasan, sube la versión en `package.json` y `package-lock.json`, crea el commit `Versión 1.1.0` y la etiqueta `v1.1.0`, sube ambos a GitHub y crea el release `Dockyard v1.1.0` con `scripts/publicar-release.sh`. Las notas del release son los títulos de los commits desde la versión anterior; si quieres redactarlas mejor, edítalas después en GitHub. El mensaje del commit sale de `.npmrc`. Las instalaciones que tengan la página abierta muestran el aviso en un máximo de 6 horas.

No crees etiquetas a mano: sin el cambio en `package.json`, una instalación al día seguiría viendo el aviso. Una etiqueta como `v2.0.0-beta` se ignora. Si el `push` falla, el commit y la etiqueta quedan locales: corrige la causa y ejecuta `git push origin main --follow-tags`. Si lo que falla es el release, ejecuta `scripts/publicar-release.sh`.

## Cómo funcionan la API y la interfaz

- **Rutas:** las de `/api/projects` responden JSON. Toda falla responde `{ "message": "…" }`: 400 por datos inválidos, 404 si no existe, 409 si el nombre se repite o choca un puerto con otro proyecto registrado, y 500 con el mensaje del núcleo.
- **Choque de puertos al encender:** `startProject` lanza `PortConflictError` con el puerto, el contenedor y su proyecto de compose. Si ese proyecto está registrado en Dockyard, la API responde 409 con `conflict: { id, name, port }` y la interfaz ofrece **Apagar … y encender este**, con confirmación: llama a la ruta de apagar del otro y luego a la de encender. Si lo que ocupa el puerto no está registrado, como Dockyard mismo u otro contenedor de la PC, se responde el mensaje del núcleo sin `conflict`: nunca se ofrece apagar algo ajeno.
- **El manejador de errores va antes de registrar las rutas** (`api/src/app.ts`). Un plugin hereda el manejador que existe al registrarse; si se define después, Fastify usa el suyo sin avisar.
- **Protección contra otras páginas:** el puerto local no basta, porque una página abierta en el navegador del docente también llega a `localhost`, incluidos los proyectos de estudiantes en otros puertos. Por eso `isAllowedRequest` (`api/src/app.ts`) exige un `Host` local y un `Origin` igual a `Host`, y responde 403 si no. Las peticiones sin `Origin`, como las de `curl`, se aceptan.
- **Enlaces:** `urls` trae uno por puerto. `url`, el del botón **Abrir**, es el primero que no sea de un servicio conocido que no es una página (como 3306 o 5432); si todos lo son, usa el primero. Es una suposición: por eso la columna **Puertos** enlaza todos.
- **Web:** `web` indica si contesta el puerto de **Abrir** (`api/src/services/web-check.ts`). Es `null` si el proyecto está apagado o solo publica puertos que no son páginas, y `unchecked` si el puerto se publicó solo en `127.0.0.1` y Dockyard corre en contenedor, donde no lo alcanza. Cualquier respuesta menor a 500 cuenta como `ok`, porque un 401 o un 404 también prueban que la aplicación está viva. La hace la API porque el núcleo no usa HTTP. Una web que contesta se vuelve a pedir cada minuto como mucho, para no gastar el límite de peticiones de los proyectos. Dentro del contenedor usa `PROJECTS_HOST` (`host.docker.internal`), porque ahí `localhost` es Dockyard.
- **Datos:** SQLite guarda solo lo que Docker no sabe (nombre, equipo, origen, carpeta). El estado y los puertos se consultan siempre al núcleo. Listar hace una sola consulta (`getProjectStatuses`) para todos los proyectos, así que su costo no crece con la cantidad; consultar uno solo usa `getProjectStatus`.
- **Búsqueda:** mira el nombre técnico, el nombre para mostrar, el equipo y la descripción; ignora mayúsculas y tildes con la función `normalizar`, registrada en SQLite, porque `LIKE` solo ignora mayúsculas en letras sin acento. `%` y `_` se buscan como texto.
- **ZIP:** se guarda en una carpeta temporal, con un límite de 200 MB, y se borra al terminar el registro, salga bien o mal.
- **Peticiones cortadas:** la ruta responde cuando el núcleo termina, hasta 10 minutos después. Firefox corta las peticiones pendientes cuando cambian las redes de la PC, y encender un proyecto crea una red de Docker (comprobado con Firefox 159; sin cambios de red, esperó 7 minutos sin problema). Por eso, si la petición se corta, la interfaz la repite, y la API la une a la operación en curso (`once` en `api/src/services/projects.ts`) en vez de lanzar otra. Así el docente recibe el resultado real, incluido el error.
- **Ficha:** cada proyecto guarda, además del nombre técnico `name`, `display_name` (1 a 80 caracteres; al registrar, lo que escribió el docente), `year` (2000 a 2100; al registrar, el actual), `description` (hasta 2000), `instructions` (hasta 4000), `contacts` (JSON con hasta 8 `{ name, email?, phone? }`) e `image`. Las bases anteriores reciben las columnas al abrirse, con el mismo patrón que `notes`: `display_name` toma el nombre técnico y `year` el año de `created_at`. La respuesta de cada proyecto trae `displayName`, `year`, `description`, `instructions`, `contacts` e `imageUrl`. La página es `/proyecto/?id=<id>` (`web/src/pages/proyecto.astro`); el menú ⋯ lleva a su edición (`#editar`) y el nombre de la lista a la ficha. Reemplazó al diálogo rápido de editar, para que haya un solo lugar que edita.
- **Nombre técnico repetido:** es único en toda la base, porque Docker y las carpetas no distinguen años. Si se repite, `POST /api/projects` responde 409 con `suggestion`: el mismo nombre con el año (`tienda-2026`) o, si también existe, con un número (`tienda-2026-2`). La interfaz ofrece usarlo con un clic y conserva lo que escribió el docente como nombre para mostrar.
- **Imagen:** `PUT /api/projects/:id/image` (multipart, campo `file`), `GET` y `DELETE` en la misma ruta. Acepta PNG, JPEG o WebP de hasta 2 MB, y el tipo sale de la firma de bytes, no del nombre ni del `Content-Type`. No acepta SVG: puede llevar scripts y se serviría desde el mismo origen que la API. Se guarda en `data/imagenes/<id>.<tipo>` (`defaultDataDir()`, o `dataDir` de `buildApp`), se sirve con su `Content-Type`, `X-Content-Type-Options: nosniff` y `Cache-Control: no-cache`, y se borra al eliminar el proyecto. `imageUrl` lleva `?v=<image_version>`, una columna que sube con cada cambio, para que el navegador no muestre la anterior.
- **Carpetas por año:** `GET /api/projects?year=2026` filtra por año (`year=todos` o sin él, todos) y `GET /api/projects/years` devuelve `[{ year, count, running }]`, el más reciente primero; `running` sale de la misma consulta única a Docker que la lista. La interfaz abre por defecto el año más reciente y guarda la carpeta en la URL (`?año=2026`, o `?año=todos`), con `pushState`, así Atrás y Adelante cambian de carpeta. La búsqueda manda `q` y `year` juntos. **Apagar todos** sigue apagando todo: se ofrece si hay algo encendido a la vista o en otra carpeta (por `running`), y dentro de un año dice «(todos los años)».
- **Vista:** `projectsView` (`table` o `grid`) va en la tabla `settings`, por `GET` y `PATCH /api/settings`, para que sea la misma en cualquier navegador. Se fija la primera vez que arranca esta versión: `table` si ya había proyectos y `grid` si no, y se guarda para que no cambie al registrar el primero.
- **Editar:** `PATCH /api/projects/:id` recibe `team`, `name`, `notes` (hasta 2000 caracteres; vacía las borra), `displayName`, `year`, `description`, `instructions` y `contacts`, al menos uno, y responde el proyecto. Se valida con TypeBox (`Value.Check`, que no quita las claves desconocidas, así que una clave desconocida responde 400). Un campo vacío de un contacto no se guarda. El equipo y los datos de la ficha solo cambian en la base. El nombre también es el del proyecto de compose y el de su carpeta, así que lo cambia `renameProject` del núcleo, con el proyecto apagado: borra los contenedores, la red y las imágenes del nombre anterior (`down --rmi local`, sin `-v`) y renombra `projects/<nombre>` y `projects/.repos/<nombre>`. Docker no puede renombrar volúmenes, así que se niega si el proyecto tiene alguno: con otro nombre empezaría sin sus datos. Las carpetas montadas con ruta relativa siguen funcionando, porque se resuelven desde la carpeta nueva. El siguiente encendido usa `--build`. La interfaz solo envía lo que cambió y muestra el error dentro del formulario.
- **Registro en segundo plano:** `POST /api/projects` responde al terminar, como siempre, pero lo que hace no depende de la pestaña: si se cierra, la API sigue. Mientras tanto, el registro figura en `GET /api/registrations` con su etapa y, al clonar, el porcentaje que escribe `git clone --progress` (`core/src/sources.ts`). La lista vive en memoria. Al terminar bien, el registro desaparece y queda el proyecto; si falla y la pestaña sigue esperando (el socket sigue abierto), el error va en la respuesta y no queda en la lista. Si falla sin nadie esperando, queda con el motivo hasta que el docente lo descarta (`DELETE /api/registrations/:key`). Un nombre que se está registrando responde 409. La interfaz vacía el formulario al enviar, así que se pueden registrar varios a la vez; si falla y el formulario sigue vacío, vuelve a poner los datos con el error. Consulta los registros cada 1,5 s solo mientras hay alguno en curso, y además con la actualización de la lista, para ver los de otra pestaña. Si la API se detiene a mitad de un registro (por ejemplo, con `update.sh`), queda la carpeta `projects/<nombre>` y el siguiente intento lo dice con la ruta a borrar.
- **Registrar varios:** `POST /api/projects/batch` recibe `{ year?, items: [{ team, name, repoUrl }] }` (de 1 a 60), validado con TypeBox, y responde 202 con `{ queued, rejected }`. Las URL que no son de GitHub y los nombres que ya existen o se repiten en la lista van a `rejected` con su posición y su motivo, sin frenar al resto. Los demás se reservan enseguida (figuran en `GET /api/registrations` con la etapa «En espera», así el nombre queda tomado y `busy()` es verdadero) y una cola en `api/src/services/projects.ts` (`enqueue` y `drainQueue`) los prepara de a uno, en orden, con el mismo `prepare` que el registro de uno. Como nadie espera su respuesta, el que falla queda en la lista con el motivo. Los ZIP no pasan por la cola: el archivo está en el navegador, así que la pestaña **Varios** los sube de a uno con `POST /api/projects`; los que no alcanzó a subir antes de cerrarse no se registran, y mientras sube pide confirmar antes de cerrar. La vista previa (`web/src/scripts/projects/batch/parse.ts`) repite la normalización del nombre solo para avisar antes de enviar; la API vuelve a validar todo.
- **Volver a encender al arrancar:** la columna `keep_running` dice si el docente dejó el proyecto encendido. Encender la pone en 1 y apagar (también apagar todos y apagar el que choca) en 0. Al empezar a escuchar, `server.ts` llama a `service.resume()` sin esperarlo: vuelve a encender, de a 2, los marcados que Docker da por apagados, con el mismo `start` que la interfaz, así que se ve el avance y una petición repetida se une. Los que encuentra encendidos y no estaban marcados quedan marcados; así, al instalar esta versión, cuenta lo que ya corría. No hace falta detectar el reinicio de la PC: si Dockyard se reinicia por `update.sh`, los proyectos siguen encendidos y no se toca nada; si se reinicia el servicio de Docker, también vuelven. Un proyecto que no enciende sigue marcado y la falla queda en el registro del contenedor. Si Docker aún no responde, se reintenta cada 10 s durante unos 2 minutos. Lo decide la API porque es estado guardado; el núcleo solo enciende.
- **Apagar todos:** `POST /api/projects/stop-all` apaga los proyectos registrados que estén encendidos según `getProjectStatuses`, de a 4 a la vez, y responde `{ stopped, skipped, failed }` con sus nombres. Salta los que se están encendiendo, actualizando o eliminando, para no cortar esa operación. Cada uno pasa por la misma unión que `stop` (`once`), y una segunda petición mientras corre la tanda espera la misma respuesta, así que la repetición tras un corte de Firefox no apaga dos veces. Lo hace la API y no la interfaz proyecto por proyecto: sigue aunque se cierre la pestaña.
- **Reiniciar datos:** `POST /api/projects/:id/reset-data` llama a `resetProjectData` del núcleo, que ejecuta `down -v --remove-orphans` con el prefijo de siempre y sin `--rmi`: borra contenedores, red y volúmenes, y conserva la carpeta y las imágenes, así que el siguiente encendido no reconstruye pero crea la base de nuevo y vuelve a cargar su `.sql`. La API responde 409 con el proyecto encendido o con otra operación en curso, como al actualizar, y responde el proyecto. No cambia `keep_running` ni `needs_build`. La interfaz pide escribir el nombre, como al eliminar.
- **Eliminar:** `DELETE /api/projects/:id` llama a `removeProject` y luego borra la fila. Si falla, la fila queda para poder reintentar. No se permite mientras el proyecto enciende o apaga (409).
- **Avance del encendido:** `GET /api/projects/:id/progress` devuelve `{ progress }`, con la etapa, las últimas 8 líneas de Docker y los segundos transcurridos, o `null` si no se está encendiendo. También llega en el campo `progress` de cada proyecto, para que recargar la página no lo pierda. Se guarda solo en memoria. La interfaz lo consulta cada 2 s.
- **Registro:** `GET /api/projects/:id/logs` devuelve las últimas 200 líneas. Mientras un proyecto está encendido y su registro abierto, la interfaz lo pide cada 3 s. No es una conexión abierta: así, cerrar la pestaña no deja procesos de `docker compose logs` colgados. El texto no se mueve mientras el docente lee más arriba o selecciona algo.
- **Consumo:** `GET /api/projects/resources` devuelve `{ memoryLimit, total, projects }`, solo de los proyectos registrados y encendidos. La CPU se expresa sobre toda la PC: 100 son todos sus núcleos. La interfaz lo pide cada 10 s con la pestaña visible y algún proyecto encendido, y la API comparte cada muestra 5 s porque `docker stats` tarda unos 2 s. No se guarda.
- **Versión nueva:** `GET /api/version` devuelve `{ current, latest, updateAvailable, checkedAt }`. `current` sale del `package.json` de la raíz; los de `core`, `api` y `web` no cuentan. `api/src/services/version.ts` consulta GitHub solo cuando la interfaz lo pide, como máximo cada 6 horas, también tras una falla, y solo con la consulta automática encendida. Sin internet no hay error ni aviso: se conserva el último dato y la falla queda en el registro del contenedor. El resultado vive en memoria. La interfaz pregunta al cargar y cada hora con la pestaña visible. `POST /api/version/check` (**Comprobar ahora**) consulta siempre, aunque la automática esté apagada, y responde 502 si GitHub no contesta.
- **Espacio en disco:** `GET /api/disk` devuelve `{ total, projects }`, con `imageBytes`, `unusedImageBytes` y `volumeBytes` de cada proyecto registrado (en cero si no tiene nada) y su suma, el más pesado primero. Lo mide `getDiskUsage` del núcleo (`core/src/disk.ts`) con `docker system df -v`, que da tamaño y contenedores de cada imagen y tamaño de cada volumen, y `docker image inspect` de las imágenes con la etiqueta `com.docker.compose.project`, para saber de qué proyecto es cada una. Compose pone esa etiqueta en las imágenes que construye (`build:`) y no en las que descarga (`image:`), así que estas no se atribuyen a nadie. `POST /api/disk/clean` llama a `pruneProjectImages` con los nombres registrados y responde `{ freedBytes, removed }`; se niega (409) si `service.busy()`, porque Docker podría estar construyendo, y una segunda petición se une a la que corre. Una **versión vieja** es una imagen del proyecto sin nombre (`<none>`) que ningún contenedor usa, ni uno apagado. La imagen actual se conserva aunque no tenga contenedores (tras Reiniciar datos), para no reconstruir al encender. Se borra con `docker image rm` sin `-f`, una por una: si un contenedor empezó a usarla, Docker se niega y se deja. `freedBytes` es cuánto bajó el total de imágenes de `docker system df`. Nunca se usan `docker builder prune`, `docker image prune` ni `docker system prune`: son de toda la PC. La página es la sección **Espacio en disco** de Configuración (`web/src/scripts/settings/disk.ts`).
- **Configuración:** `GET /api/settings` y `PATCH /api/settings` leen y guardan los ajustes en la tabla `settings` de la base (`api/src/services/settings.ts`). Hay dos: `updateCheck`, que mientras el docente no lo cambie vale lo que diga `UPDATE_CHECK`, y `projectsView`, que se cambia desde Proyectos. La página es `web/src/pages/configuracion.astro` y su lógica, `web/src/scripts/settings/main.ts`.
- **Actualizar desde la página:** `update.sh` reconstruye y reemplaza el contenedor de Dockyard, así que no puede correr dentro de él. `POST /api/update` llama a `startSelfUpdate` del núcleo (`core/src/self-update.ts`), que lee del propio contenedor (`docker inspect` con su nombre de máquina) la imagen, el usuario, los grupos y la carpeta de instalación (etiqueta `com.docker.compose.project.working_dir` que pone compose), y lanza con ellos el contenedor auxiliar `dockyard-actualizacion`: la carpeta montada en la misma ruta, el socket de Docker y `--network host`, porque `update.sh` comprueba al final que Dockyard responda en `localhost`. El auxiliar no es parte del proyecto de compose, así que sobrevive al reinicio de Dockyard. Ejecuta `./update.sh` y deja la salida en `data/actualizacion.log` y el código de salida en `data/actualizacion.estado`, que la API lee en `GET /api/update` (`{ supported, running, last }`), también después de reiniciarse. La API se niega (409) si no hay versión nueva o si hay encendidos, apagados o registros en curso, que se cortarían. La página espera hasta que `GET /api/version` responde otra versión y se recarga; las fallas de conexión mientras tanto son el reinicio. Fuera del contenedor (en desarrollo) `supported` es `false` y la página remite a `./update.sh`. No se cambió `docker-compose.yml` ni `.env`: todo sale del contenedor en marcha.
- **Documentación:** `docs/*.md` es la única fuente: Astro la convierte en páginas al compilar, así que un cambio se ve al reconstruir. Un documento nuevo se agrega a la lista de `web/src/lib/docs.ts`.
- **Refresco:** la interfaz consulta la lista cada 15 segundos y al volver a la pestaña, sin redibujar si nada cambió.
- **Búsqueda en la interfaz:** espera 300 ms desde la última tecla y descarta cualquier respuesta que no sea la de la última petición.

## Contrato entre el núcleo y la API

```ts
normalizeProjectName(name: string): string
prepareProject(source: ProjectSource, name: string, options?: PrepareOptions): Promise<PreparedProject>   // { dir, name }
startProject(dir: string, name: string, options?: StartOptions): Promise<ProjectStatus>   // { state, ports }
updateProject(name: string): Promise<ProjectUpdate>   // { dir, changed, commit, summary }
replaceProjectZip(name: string, filePath: string): Promise<ZipReplacement>   // { dir, leftover }
resetProjectData(dir: string, name: string): Promise<void>
getDiskUsage(): Promise<DiskUsage>   // { projects: { [nombre]: { imageBytes, unusedImageBytes, volumeBytes } } }
pruneProjectImages(names: string[]): Promise<ImagesPruned>   // { freedBytes, removed }
stopProject(dir: string, name: string): Promise<ProjectStatus>
getProjectStatus(name: string): Promise<ProjectStatus>
getProjectStatuses(): Promise<Record<string, ProjectStatus>>   // por nombre de proyecto de compose
getResources(): Promise<ResourceUsage>
getLatestVersion(repoUrl: string): Promise<string | null>
isNewerVersion(candidate: string, current: string): boolean
reviewProject(dir: string, name: string): Promise<string[]>

type ProjectSource = { type: 'git'; url: string } | { type: 'zip'; filePath: string }
```

| Función | Qué hace | Falla cuando |
|---|---|---|
| `normalizeProjectName` | Convierte un nombre libre en uno válido para compose (`Álvarez & Co.` → `alvarez-co`) | Nunca; si no queda nada devuelve `proyecto` |
| `startSelfUpdate`, `getSelfUpdateStatus` | Lanza `update.sh` en un contenedor auxiliar y dice si se puede y si ya corre | Dockyard no corre instalado con `install.sh`, corre como root o ya se está actualizando |
| `prepareProject` | Crea `projects/<nombre>`, obtiene el código, copia `.env.example` a `.env` y devuelve la carpeta del compose. Avisa su etapa con `onProgress` | La carpeta ya existe, la URL no es `https://`, el clonado o la descompresión fallan, o no hay compose |
| `startProject` | Revisa choques de puertos y ejecuta `up -d` | Un puerto está en uso (`PortConflictError`, con `port`, `container` y `project`), Docker no responde, el compose falla o los contenedores se caen al arrancar |
| `stopProject` | Ejecuta `stop` | Docker no responde |
| `getProjectStatus` | Lee `ps --format json` | Docker no responde |
| `getProjectStatuses` | Lee `docker ps -a` una sola vez y agrupa por proyecto de compose. Un proyecto sin contenedores no aparece: está apagado | Docker no responde |
| `updateProject` | Trae la última versión del repositorio sin encender ni reconstruir | No hay conexión, el repositorio ya no es público, pisaría un archivo cambiado en la PC o la versión nueva no trae compose |
| `replaceProjectZip` | Cambia el código por el de un ZIP nuevo sin encender ni reconstruir. `leftover` es la carpeta anterior que no se pudo borrar por tener archivos de root | El ZIP está dañado, no es seguro, no trae compose o no existe la carpeta del proyecto. En todos esos casos el proyecto queda como estaba |
| `resetProjectData` | Ejecuta `down -v` sin `--rmi`: borra contenedores, red y volúmenes; conserva la carpeta, las imágenes y las carpetas montadas | El nombre no está normalizado, no hay compose o Docker no responde |
| `getResources` | Une `docker ps` y `docker stats` por proyecto de compose | Docker no responde |
| `getDiskUsage` | Lo que ocupan las imágenes construidas, sus versiones viejas y los volúmenes de cada proyecto de compose de la PC | Docker no responde |
| `pruneProjectImages` | Borra las versiones viejas de las imágenes de esos proyectos; nunca volúmenes, otras imágenes ni la caché de construcción | Un nombre no está normalizado o Docker no responde |
| `getLatestVersion` | Devuelve la etiqueta `vX.Y.Z` más alta del repositorio con `git ls-remote`, sin descargarlo. Ignora otros formatos | No hay conexión o el repositorio no responde en 15 s |
| `isNewerVersion` | Compara dos versiones por número | Nunca; un formato distinto no cuenta como más nuevo |
| `reviewProject` | Devuelve avisos sobre el compose y los archivos, sin encender nada | Nunca por el contenido del proyecto; si algo no se pudo revisar, también lo avisa |

Reglas que cumple el núcleo:

- **Errores.** Toda falla es un `Error` con un mensaje en español que dice la causa y qué hacer. La API lo devuelve al docente tal cual.
- **Nombres.** `startProject`, `stopProject` y `getProjectStatus` rechazan nombres que no estén normalizados. La API debe guardar el `name` que devuelve `prepareProject`.
- **Conflictos antes de clonar.** La API puede llamar a `normalizeProjectName` antes de `prepareProject` para comprobar si el nombre ya existe en su base y responder 409 sin esperar un clonado.
- **ZIP.** El núcleo no borra el ZIP: lo creó la API, así que la API lo borra al terminar. Antes de extraerlo lee su lista de archivos y lo rechaza si una ruta sale de la carpeta, si trae más de 100 000 archivos o si ocuparía más de 3 GB.
- **Actualizar.** El repositorio vive en `projects/.repos/<nombre>` y no en la carpeta del proyecto, porque los contenedores suelen montarla: un hook o una configuración plantados en `.git` se ejecutarían dentro de Dockyard, que controla Docker. Se descarga solo la última versión (`fetch --depth 1`) y se aplica con `read-tree -m -u`, que no necesita historia en común y se niega a pisar archivos cambiados. Por eso los proyectos no encuentran `.git` en su carpeta. La API solo actualiza proyectos apagados, repite la revisión y marca `needs_build` para que el siguiente encendido use `up -d --build`, porque `up -d` no reconstruye una imagen que ya existe.
- **Reemplazar ZIP.** Es el equivalente de **Actualizar** para las entregas en ZIP: `POST /api/projects/:id/replace` recibe el archivo igual que el registro y lo borra al terminar. El núcleo abre el ZIP en `projects/.reemplazos/<nombre>/nuevo`, con las mismas revisiones que al registrar, y solo si trae compose cambia las carpetas con `rename`, que no depende de los permisos de lo que hay dentro. Así, un ZIP que no sirve deja el proyecto intacto. La versión anterior se borra entera, incluido lo que el proyecto guardó en su carpeta: no se puede saber qué era código borrado y qué eran datos. Los volúmenes de Docker siguen, porque el nombre del proyecto de compose no cambia. Si la versión anterior tiene archivos de root, queda en `.reemplazos/<nombre>/anterior` y la interfaz da el comando `sudo` para borrarla; el siguiente reemplazo pide borrarla antes. Como se pierde lo de la carpeta, la interfaz pide escribir el nombre, igual que al eliminar.
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

Las pruebas con Docker usan una carpeta temporal como `PROJECTS_DIR` y eliminan al final los contenedores y volúmenes que crearon. Necesitan libres los puertos 8081 a 8085.

## Límites conocidos y mejoras sugeridas

Esta entrega no las incluye. Mientras tanto, el docente registra solo proyectos que conozca.

- **La revisión no es una auditoría.** Busca patrones conocidos: no lee el código para entender lo que hace, ni lo que un Dockerfile o una imagen ejecutan al arrancar, y omite carpetas como `node_modules` y archivos de más de 1 MB. Un proyecto sin avisos no queda garantizado como seguro. Se repite solo al actualizar.
- **Repositorios privados**: hoy el clonado falla de inmediato (`GIT_TERMINAL_PROMPT=0`).
- **Reescritura automática de puertos o subdominios con Traefik**: Traefik da subdominios `.localhost`, pero exige saber qué servicio y qué puerto interno expone cada proyecto.
- **Límites de recursos** por proyecto.
- **Login** para el docente.
- La comprobación de la web no alcanza un puerto publicado solo en `127.0.0.1` (como `"127.0.0.1:8101:80"`) cuando Dockyard corre en contenedor. En ese caso no lo intenta y dice «No se puede comprobar desde Dockyard; ábrelo para verlo» en vez de «no responde»: el núcleo marca esos puertos en `loopbackPorts` y `createWebChecker` sabe si su `PROJECTS_HOST` es la PC. Comprobarlos de verdad exigiría cambiar la red del contenedor (`network_mode: host`), que toca la seguridad y el despliegue y queda a decisión del responsable. Tampoco entiende HTTPS.
- **Liberar espacio** no borra la caché de construcción de Docker (`docker builder prune`), que suele ser buena parte de lo que `docker system df` llama recuperable: es de toda la PC y no dice de qué proyecto es cada parte. Tampoco borra imágenes descargadas que ya nadie usa. El docente puede hacerlo en una terminal si sabe que no afecta a otros programas.
- Las versiones viejas solo quedan con el almacén de imágenes clásico de Docker (overlay2). Con el de containerd, que Docker 29 usa por defecto en instalaciones nuevas, la imagen anterior desaparece sola al reconstruir y la columna queda en cero; lo que ocupa queda en la caché de construcción. Se comprobó con Docker 29.10 y Compose 5.7 en los dos almacenes.
- La detección de puertos antes de encender solo ve contenedores. Si otro programa de la PC usa el puerto, falla `up -d`; el núcleo reconoce en la salida de Docker los textos de puerto ocupado (`address already in use`, `port is already allocated`) y responde «El puerto N ya lo usa otro programa de esta PC que no es un proyecto de Docker…», y detiene los servicios que alcanzaron a arrancar. Si Docker cambia esos textos, vuelve a llegar el mensaje de Docker.
- Actualizar no toca los datos: un volumen de base de datos conserva sus tablas, así que un `.sql` nuevo de `db/init/` no se vuelve a cargar hasta usar **Reiniciar datos**. Tampoco cambia un `.env` que ya exista, aunque cambie `.env.example`.
- Un proyecto de ZIP no se actualiza: se reemplaza su ZIP. Como en Actualizar, un volumen de base de datos conserva sus tablas y un `.sql` nuevo de `db/init/` no se vuelve a cargar hasta usar **Reiniciar datos**. El `.env`, en cambio, sale del ZIP nuevo o de su `.env.example`, porque la carpeta se cambia entera.
- **Reiniciar datos** solo borra volúmenes de Docker. Un proyecto que guarda su base en una carpeta montada (`./data:/var/lib/mysql`) la conserva, porque esa carpeta es parte de su código; para empezar limpio, el equipo debe quitarla o el docente eliminar el proyecto y registrarlo de nuevo.

## Pruebas de interfaz

`web/test/*.test.mjs` usa Chromium con Playwright, sirve solo el frontend compilado e intercepta todas las rutas de la API. No usa Docker ni modifica proyectos reales. CI también ejecuta estas pruebas después de compilar.

```bash
npx playwright install chromium  # una vez, después de npm install
npm run test:ui -w web
```

Cubre registro por ZIP y GitHub, registro continuo, recuperación de errores, búsqueda, teclado, foco tras refrescos, cierre de diálogos, confirmación de eliminación y anchos de 320 a 1440 px. Para guardar capturas, define `UI_SCREENSHOTS` con una carpeta existente.

El registro se abre con `register-panel.ts`. `dialog-focus.ts` recupera el botón lógico al cerrar un diálogo aunque el refresco haya reemplazado la fila. `table.ts` conserva foco y desplegables por identidad, y las acciones secundarias usan un `details` nativo.

## Aplicación instalable (PWA)

`web/public/manifest.webmanifest` usa identidad, inicio y alcance relativos a la raíz del origen, sin fijar el puerto; abre en modo `standalone`. Los iconos PNG de 192 y 512 px y el icono maskable se derivan del favicon existente. El logo de Software se conserva en la interfaz y en la ayuda de conexión.

`InstallApp.astro` y `scripts/pwa.ts` ofrecen la instalación únicamente al pulsar el botón. Si no hay `beforeinstallprompt`, muestran instrucciones; en modo standalone se oculta el botón. El service worker se registra solo en producción y no fuerza recargas.

`public/sw.js` busca siempre la navegación en la red; si el servicio no responde o devuelve un error 5xx, muestra `offline.html`. Solo precarga esa página y sus imágenes. No cachea HTML del aula, paquetes JS/CSS ni respuestas de `/api`; no intercepta mutaciones ni otros orígenes o puertos. No hay sincronización de acciones en segundo plano. Cambia `dockyard-offline-v1` cuando modifiques la página de ayuda o sus imágenes. La activación limpia únicamente versiones anteriores de esa caché.

El worker usa `skipWaiting` y `clients.claim` porque no mantiene una versión de la interfaz: no hay paquetes antiguos que mezclar. `updateViaCache: none` permite consultar actualizaciones del worker sin reutilizar la caché HTTP. La PWA funciona en el origen local confiable (`localhost` o `127.0.0.1`), sin abrir la herramienta a la red. El navegador administra la instalación en el sistema; no levanta Docker.

Las pruebas PWA comprueban el manifiesto con el protocolo de Chromium, las dimensiones de los iconos, caída y recuperación del servicio, uso sin conexión, cancelación/aceptación de la solicitud y limpieza de cachés antiguas. La instalación real en el menú del sistema la confirma el docente desde su navegador; las pruebas no instalan aplicaciones en el equipo.
