# Hoja de ruta de noviembre de 2026

Documento de trabajo temporal. Lo escribió la sesión local el 2026-11-18 para una sesión de Claude Code en la nube que trabajará sin supervisión durante la noche. Al despertar, el usuario compara lo que hizo esa sesión con este plan. Cuando deje de servir, se borra la carpeta `planes/` completa.

No es documentación del proyecto: no lo enlaces desde `docs/` ni lo publiques en la interfaz.

## Antes de empezar

### Lee primero

1. `AGENTS.md`: arquitectura, fronteras entre carpetas, contrato del núcleo, rutas de la API, convenciones y despliegue. **Es obligatorio y manda sobre cualquier costumbre tuya.**
2. `docs/guia-tecnica.md`: cómo está implementado y por qué, incluida la sección «Límites conocidos y mejoras sugeridas».
3. `docs/manual-usuario.md` y `docs/privacidad.md`: lo que se le promete al docente.
4. El código del área que vayas a tocar, antes de cambiarlo.

### Contexto que no está en el repositorio

- Dockyard lo usa un docente en su PC (Ubuntu, sin internet expuesto, sin login) para revisar los proyectos de sus estudiantes. Un curso tiene del orden de 10 a 20 equipos, y cada año se suma una tanda nueva.
- El responsable del proyecto es 0V3R. Isaac entregó `api/` y `web/` y ya no participa.
- La versión publicada es la 1.3.3. Todo lo de la hoja de ruta anterior está terminado y publicado.
- El usuario prioriza, en este orden: que funcione, que la estructura sea clara para el grupo que herede el proyecto, y la modularidad (archivos pequeños con una sola tarea).

### Reglas para esta sesión

- **Trabaja en una rama propia**, nunca en `main`. Si el entorno ya te dio una rama, úsala.
- **Un commit por función**, en español, con un mensaje que diga qué cambia para el docente. Sin atribución de agentes: nada de `Co-Authored-By`, «Generated with…», enlaces de sesión ni líneas similares. Revisa cada mensaje con `git log -1 --format=%B` antes de seguir.
- **No publiques versiones.** No ejecutes `npm version`, `install.sh`, `update.sh` ni `scripts/publicar-release.sh`, y no crees etiquetas ni releases. Las versiones las publica el usuario desde `main`.
- **Al terminar, sube tu rama y abre un pull request hacia `main`**, sin fusionarlo. El usuario lo revisa.
- **Respeta las fronteras de `AGENTS.md`:**
  - el núcleo (`core/`) solo ejecuta `git`, `unzip` y `docker compose`/`docker`, y nunca hace HTTP, usa SQLite ni toca la interfaz;
  - la API orquesta y nunca ejecuta Docker ni git;
  - la interfaz no decide estados.
- **Al cambiar un contrato**, actualiza `AGENTS.md`, `docs/guia-tecnica.md` y las pruebas en el mismo commit.
- **Cada función nueva actualiza el manual** (`docs/manual-usuario.md`). Si cambia lo que se guarda, actualiza también `docs/privacidad.md`.
- **Código, mensajes de error, interfaz y documentación, en español.** Los errores dicen la causa y qué hacer.
- **Interfaz:**
  - usa los tokens `marca-*` de `web/src/styles/global.css` y la rejilla de 12 columnas;
  - pon la lógica en `web/src/scripts/<página>/`, un módulo por tarea, y deja los `.astro` solo con HTML;
  - las acciones destructivas piden escribir el nombre exacto del proyecto, y las que se pueden deshacer, una confirmación de un clic.
- **Sin recursos de otros sitios, analítica ni telemetría.** Todo se sirve desde Dockyard.
- **Si una decisión de este documento resulta imposible o mala al implementarla**, toma la alternativa más simple que respete las reglas y anótala en el registro de avance (al final). No te detengas a preguntar: nadie va a responder hasta la mañana.

### Entorno y pruebas

```bash
npm install          # Node 24 o superior
npm run build        # compila core, api y web
npm run typecheck
npm test             # núcleo y API, sin Docker
npm run test:ui -w web          # interfaz con Chromium (antes: npx playwright install chromium)
npm run test:docker -w core     # con Docker real, si el entorno lo tiene
```

Antes de cada commit deben pasar `build`, `typecheck` y `npm test`. Corre `test:ui` si puedes instalar Chromium y `test:docker` si hay Docker. Si alguna no se puede correr en tu entorno, dilo en el registro de avance; no la des por buena.

Cada función nueva necesita pruebas:
- **núcleo:** las funciones puras en `core/test/unit.test.ts`; lo que usa Docker, en `core/test/docker.test.ts`;
- **API:** sus rutas, con el núcleo simulado, en `api/test/`;
- **interfaz:** sus flujos, con rutas interceptadas, en `web/test/`.

## Orden de trabajo

Hazlas en este orden, una a la vez y con su commit. La ficha enriquecida (3) va antes que registrar varios (5) y que exportar (7), porque esas dos usan los campos nuevos. Si no alcanzas a terminar todo, es mejor dejar menos funciones completas que muchas a medias.

1. Reiniciar los datos de un proyecto
2. Espacio en disco
3. Ficha enriquecida del proyecto
4. Vista en cuadrícula o tabla y carpetas por año
5. Registrar varios proyectos a la vez
6. Mensajes claros sobre puertos
7. Exportar e importar la lista de proyectos

---

## 1. Reiniciar los datos de un proyecto

**Problema.** Si un equipo corrige el `.sql` de `db/init/`, la base no se vuelve a cargar, porque el volumen ya existe. Hoy la única salida es eliminar el proyecto y registrarlo de nuevo.

**Qué hace.** Borra los contenedores y los volúmenes del proyecto, pero conserva su código, su ficha y su registro en Dockyard. En el siguiente encendido, la base se crea de nuevo y vuelve a cargar su `.sql`.

**Núcleo**
- Agrega `resetProjectData(dir, name): Promise<void>`. Ejecuta `docker compose … down -v` con el prefijo de siempre (`-p`, `--project-directory`, `-f`), sin `--rmi`. Las imágenes se conservan, así el siguiente encendido no reconstruye.
- Rechaza nombres sin normalizar (`assertNormalizedName`).
- No borra carpetas montadas desde el proyecto (por ejemplo `./data:/var/lib/mysql`). Eso es código del equipo.

**API**
- Agrega `POST /api/projects/:id/reset-data`.
- Responde 409 si el proyecto está encendido o tiene una operación en curso, con el mismo criterio que actualizar.
- No cambia `keep_running` ni `needs_build`.

**Interfaz**
- Agrega «Reiniciar datos» en el menú ⋯, separado de las acciones normales, junto a «Eliminar».
- Pide escribir el nombre exacto del proyecto, como Eliminar.
- El diálogo explica que se borran las bases de datos y los archivos que el proyecto guardó en volúmenes de Docker, que el código y la ficha se conservan, y que los datos guardados en carpetas del proyecto no se tocan.
- Con el proyecto encendido, aparece bloqueado y muestra el motivo como hoy «Actualizar»: con `aria-disabled` y un globo al pasar el puntero o al intentar usarlo.

**Documentación**
- En el manual, cuándo usarlo.
- En la guía técnica, quita del límite conocido «Para empezar limpio, elimina el proyecto…» y explica la función nueva.

## 2. Espacio en disco

**Problema.** Cada encendido con `--build` deja imágenes viejas. En la PC del usuario, Docker ocupa unos 33 GB y reporta 15,5 GB como recuperables.

**Qué hace.** Muestra cuánto ocupa cada proyecto registrado y libera lo que sobra, **solo de los proyectos registrados**. Nunca toca imágenes, volúmenes ni caché de otras cosas de la PC.

**Núcleo**
- Agrega `getDiskUsage(): Promise<DiskUsage>`.
  - Fuente: `docker system df -v --format json`, o `docker image ls` y `docker volume ls` con filtros por la etiqueta `com.docker.compose.project`.
  - Devuelve, por proyecto de compose: los bytes de imágenes en uso, los bytes de imágenes sin uso (versiones viejas) y los bytes de volúmenes.
  - Como `getResources`, devuelve todos los proyectos de compose; la API deja solo los registrados.
- Agrega `pruneProjectImages(names: string[]): Promise<{ freedBytes, removed }>`.
  - Borra solo las imágenes con la etiqueta `com.docker.compose.project` de esos nombres que **no use ningún contenedor**.
  - **Comprueba en Docker real** que compose etiqueta las imágenes que construye y que las versiones viejas («dangling») conservan la etiqueta. Si no la conservan, borra solo lo que puedas atribuir con seguridad a esos proyectos y anota la limitación.
  - No borra volúmenes ni ejecuta `docker builder prune` ni `docker system prune`, porque son globales y tocarían cosas que no son de Dockyard.

**API**
- Agrega `GET /api/disk` y `POST /api/disk/clean`.
- La limpieza se niega (409) si `service.busy()` es verdadero, porque se podría borrar una imagen que se está construyendo.

**Interfaz**
- En Configuración, agrega una sección «Espacio en disco» con:
  - el total que ocupan los proyectos registrados;
  - una tabla por proyecto (imágenes, versiones viejas, datos);
  - un botón «Liberar espacio» con confirmación de un clic que dice cuánto se recuperará;
  - después de liberar, cuánto se recuperó.
- Aclara en una línea que los datos (volúmenes) no se borran desde aquí: se borran con «Reiniciar datos» o «Eliminar».

## 3. Ficha enriquecida del proyecto

**Pedido del usuario.** Que cada registro sea mucho más rico: un nombre para mostrar distinto del nombre técnico, el año, una imagen, una descripción, las indicaciones del equipo y los datos de contacto de los estudiantes.

### Datos

Agrega columnas a `projects` en `api/src/db/projects.ts`, con el mismo patrón de migración que `notes` (`ALTER TABLE … ADD COLUMN` si no existe). Las bases existentes deben seguir funcionando.

| Campo (API) | Columna | Tipo y límites | Valor por defecto |
|---|---|---|---|
| `displayName` | `display_name` | texto, 1 a 80 caracteres | el `name` actual |
| `year` | `year` | entero de 2000 a 2100 | el año de `created_at` (migración) o el año actual (proyectos nuevos) |
| `description` | `description` | texto, hasta 2000 | `''` |
| `instructions` | `instructions` | texto, hasta 4000: cómo usarlo, usuarios de prueba, rutas importantes | `''` |
| `contacts` | `contacts` | JSON con hasta 8 contactos `{ name, email?, phone? }`. `name` va de 1 a 80; `email` se valida como correo; `phone` va hasta 30 | `'[]'` |
| `image` | `image` | nombre del archivo de la imagen o `NULL` | `NULL` |

- `name` sigue siendo el nombre técnico: el normalizado, único, que usan Docker y las carpetas. No cambia su significado.
- `notes` sigue siendo la nota privada del docente. `description` e `instructions` son lo que cuenta el equipo.
- **Nombres repetidos entre años:** el nombre técnico es único en toda la base, y cada año habrá otra «tienda». Si al registrar el nombre ya existe, el error debe sugerir `<nombre>-<año>`, y el formulario debe ofrecer usarlo con un clic. No hagas el nombre técnico único por año: Docker y las carpetas no lo permitirían.

### Imagen

- `PUT /api/projects/:id/image` (multipart, campo `file`), `DELETE /api/projects/:id/image` y `GET /api/projects/:id/image`.
- **Formatos:** PNG, JPEG o WebP, hasta 2 MB. Verifica la firma de bytes del archivo, no solo la extensión ni el `Content-Type`.
- **Sin SVG.** Un SVG puede llevar scripts y se serviría desde el mismo origen que la API.
- Se guarda en `data/imagenes/<id>.<ext>`, junto a la base. Usa `defaultDataDir()`.
- Al servirla, envía `Content-Type` correcto, `X-Content-Type-Options: nosniff` y `Cache-Control: no-cache`. El JSON del proyecto trae `imageUrl` con un parámetro de versión para que el navegador la recargue al cambiar.
- Al eliminar el proyecto, se borra su imagen.
- **Ícono automático, opcional; hazlo solo si te sobra tiempo:**
  - Si el docente no subió imagen, la API puede pedirle al núcleo el ícono que trae el proyecto. Solo busca `favicon.png`, `favicon.ico`, `logo.png` y `icon.png` en la raíz y en carpetas típicas (`public/`, `static/`, `assets/`, `src/assets/`); no ejecuta nada.
  - Debe ser una función del núcleo que solo lea archivos, como `reviewProject`.
- **Sin imagen**, la interfaz muestra la inicial del nombre para mostrar sobre un color derivado del nombre, con los tokens `marca-*`.

### API

- `PATCH /api/projects/:id` acepta también `displayName`, `year`, `description`, `instructions` y `contacts`, validados con TypeBox. Rechaza claves desconocidas con 400: Fastify las quita antes de validar, así que comprueba que llegue al menos una clave conocida, como hace `PATCH /api/settings`.
- `POST /api/projects` acepta `displayName` y `year` al registrar. Los demás campos se completan después, en la ficha.
- `GET /api/projects` agrega:
  - el filtro `year=` (y `year=todos`);
  - la búsqueda `q`, que también mira `displayName` y `description`;
  - la ruta `GET /api/projects/years`, con la lista de años y cuántos proyectos tiene cada uno, para las carpetas de la función 4.

### Página de ficha

- Crea la página `/proyecto/?id=<id>`: `web/src/pages/proyecto.astro` con su lógica en `web/src/scripts/project/`.
- **Muestra:** imagen, nombre para mostrar, nombre técnico (pequeño), equipo, año, estado con Encender/Apagar y Abrir, descripción, indicaciones del equipo, contactos (correo como `mailto:`), notas del docente, avisos de la revisión y el consumo, si está encendido.
- **Editar** abre un formulario en la misma página con todos los campos, incluida la imagen.
  - El menú ⋯ de la lista lleva a esa edición.
  - El diálogo rápido de editar que existe hoy se reemplaza por la página, para no tener dos lugares que editan lo mismo.
- En la lista, el nombre del proyecto enlaza a su ficha.

### Privacidad

`docs/privacidad.md` debe decir:
- que se guardan datos de contacto de estudiantes;
- que se guardan imágenes;
- dónde se guardan (`data/`);
- que nunca salen de la PC;
- que se borran al eliminar el proyecto.

## 4. Vista en cuadrícula o tabla y carpetas por año

**Vista**
- En Proyectos, agrega un selector «Tabla | Cuadrícula» (dos botones con `aria-pressed`).
- La preferencia se guarda en la tabla `settings` (clave `projectsView`, valores `table` o `grid`) con `PATCH /api/settings`. Así es la misma en cualquier navegador del docente.
- Los valores por defecto son `table` en las instalaciones existentes y `grid` en las nuevas (sin proyectos).
- **Cuadrícula:**
  - tarjetas en la rejilla de 12 columnas: `col-span-12 sm:col-span-6 lg:col-span-4 xl:col-span-3`;
  - cada tarjeta muestra la imagen grande (o la inicial), el nombre para mostrar, el equipo, el estado, Encender/Apagar, Abrir y el menú ⋯ con las mismas acciones que en la tabla;
  - la tarjeta enlaza a la ficha;
  - el avance de encendido, los avisos y los errores se ven en la tarjeta, como en la fila.
- **Reutiliza la lógica de acciones** (`actions.ts`, `run-action.ts`, el menú popover de `rows/project-row.ts`). Si hace falta, extrae el menú y los botones a módulos compartidos; no copies código entre fila y tarjeta.
- El refresco automático debe conservar el foco y los menús abiertos, como hoy en `table.ts`.

**Carpetas por año**
- Desde `lg`, agrega una columna lateral (`lg:col-span-2`) con las carpetas, por ejemplo «📁 2026 · 12». La lista ocupa `lg:col-span-10`. En pantallas angostas, las carpetas son una fila de botones que se desplaza.
- Hay una carpeta por año con proyectos y una carpeta «Todos».
- Por defecto se abre el año más reciente con proyectos.
- La búsqueda busca dentro de la carpeta abierta; si no encuentra nada, ofrece buscar en «Todos».
- La carpeta abierta va en la URL (`?año=2026`), para que recargar o compartir el enlace la conserve.
- **«Apagar todos» sigue apagando todo**, no solo la carpeta. Deja el texto claro.
- Actualiza en `AGENTS.md` la regla de maquetación: Proyectos deja de usar las 12 columnas completas.

## 5. Registrar varios proyectos a la vez

**Problema.** El día de la entrega, el docente registra 10 a 20 proyectos uno por uno.

**Desde GitHub**
- En el panel de registro, agrega una pestaña «Varios», con un área de texto donde cada línea es `equipo; nombre; url`. Acepta también comas o tabuladores, para poder pegar desde una hoja de cálculo.
- Un campo de año común (el actual por defecto) se aplica a todas las líneas.
- Antes de enviar, muestra una vista previa con una fila por línea y sus errores (URL no `https://`, nombre repetido en la lista o ya registrado, línea incompleta). Solo se envían las líneas válidas.
- `POST /api/projects/batch` recibe la lista validada con TypeBox y la encola. Los registros corren **uno a la vez**, para no saturar la red ni el disco.
- Cada registro aparece en `GET /api/registrations` como hoy, con su etapa y porcentaje. Siguen corriendo aunque se cierre la pestaña, y los que fallen quedan con su motivo hasta descartarlos.

**Desde ZIP**
- En la misma pestaña, el docente puede elegir varios ZIP.
- Por cada archivo, una fila editable con el equipo y el nombre. El nombre sale del archivo, normalizado.
- Los ZIP se suben uno a la vez desde la página con el `POST /api/projects` de hoy, porque el archivo vive en el navegador. Si se cierra la pestaña, los ZIP que no se subieron no se registran: dilo en la interfaz.

**Pruebas:** que una lista con líneas válidas e inválidas registre solo las válidas, en orden y una a la vez (con el núcleo simulado).

## 6. Mensajes claros sobre puertos

Las dos fallas están en los límites conocidos de `docs/guia-tecnica.md`.

**Puerto ocupado por un programa que no es Docker**
- Hoy falla `up -d` y llega el texto de Docker en inglés.
- En el núcleo, reconoce en la salida de `up -d` los mensajes de puerto ocupado (`address already in use`, `port is already allocated`, `bind: …`).
- Lánzalos como un `Error` en español: «El puerto N ya lo usa otro programa de esta PC que no es un proyecto de Docker. Ciérralo o cambia el puerto en el compose del proyecto.»
- Pruébalo con una función pura que reciba el texto de Docker.

**Comprobación de la web con un puerto publicado solo en `127.0.0.1`**
- Cuando Dockyard corre en contenedor, la comprobación de la web no alcanza un puerto publicado como `"127.0.0.1:8101:80"` y dice «no responde» aunque el proyecto abra en el navegador.
- **No cambies la red del contenedor de Dockyard** (por ejemplo, `network_mode: host`): toca la seguridad y el despliegue, y lo decide el usuario.
- En su lugar, cuando el puerto está publicado solo en `127.0.0.1` y Dockyard corre en contenedor, muestra «No se puede comprobar desde Dockyard; ábrelo para verlo» en vez de «no responde».
- Si la información de en qué IP se publicó el puerto no llega hoy a la API, agrégala al estado que devuelve el núcleo, sin romper el contrato existente: un campo opcional nuevo.

Actualiza los límites conocidos.

## 7. Exportar e importar la lista de proyectos

**Para qué.** Pasar a otra PC o recuperarse tras reinstalar.

**Exportar**
- `GET /api/export` descarga `dockyard-proyectos-<fecha>.json` con: versión del formato, versión de Dockyard, fecha y, por proyecto, `name`, `displayName`, `team`, `year`, `sourceType`, el URL si es de GitHub, `notes`, `description`, `instructions`, `contacts` y la imagen en base64 si tiene.
- **No incluye** el código, los datos de Docker ni los avisos (se recalculan).
- La interfaz avisa que el archivo contiene los datos de contacto de los estudiantes.

**Importar**
- `POST /api/import` recibe el archivo, validado con TypeBox, y muestra una vista previa antes de aplicar:
  - **Proyectos de GitHub:** se registran con la cola de la función 5, con todos sus campos.
  - **Proyectos de ZIP:** se listan como «necesita su ZIP». Se pueden registrar después con su archivo, conservando la ficha importada.
  - **Nombres que ya existen:** se omiten y se informan. Nunca se sobrescribe un proyecto.
- En la interfaz, va en Configuración, sección «Respaldo», con «Exportar lista» e «Importar lista».

**Documentación:** privacidad (el archivo exportado sale de Dockyard en manos del docente) y manual.

---

## Fuera de esta ronda

No los empieces: límites de memoria y CPU por proyecto, repositorios privados, Traefik con subdominios, login, y cambiar la red del contenedor de Dockyard.

## Registro de avance

La sesión en la nube completa esta sección al terminar cada función, para que el usuario la compare con el plan.

Por función:
- **Estado:** terminada, parcial o no empezada.
- **Commit.**
- **Decisiones que se apartaron del plan**, y por qué.
- **Pruebas que se corrieron y su resultado.** Indica cuáles no se pudieron correr.
- **Pendientes y riesgos.**

Al final:
- el enlace del pull request;
- un resumen de lo que conviene revisar primero.

Entorno de la sesión: Node 24.22 (`/opt/node24`), Docker 29.10 levantado dentro del contenedor de la sesión (`dockerd`, con el almacén de imágenes de containerd) y Chromium 1243 preinstalado. Para `test:ui` se apuntó `PLAYWRIGHT_BROWSERS_PATH` a una carpeta temporal con enlaces a ese Chromium, porque el proyecto pide la revisión 1255 y no hay red para descargarla; no se cambió nada del repositorio por esto. Antes de empezar, `test:docker` daba 29 bien, 2 omitidas (las de archivos de root, porque la sesión corre como root) y 1 falla ajena al código: Docker Hub respondió 429 (límite de descargas) a `postgres:16-alpine` en «prueba-bd».

### 1. Reiniciar los datos de un proyecto

- **Estado:** terminada.
- **Commit:** ver la lista de commits al final.
- **Decisiones que se apartaron del plan:** `resetProjectData` usa `down -v --remove-orphans` (sin `--rmi`, como pide el plan); `--remove-orphans` solo quita contenedores de servicios que el compose ya no tiene. La ayuda que bloquea la acción con el proyecto encendido quedó en un ayudante común de `rows/project-row.ts` (`blockedWhileRunning`), que ahora usan también Actualizar y Reemplazar ZIP. El id del globo pasó de `update-hint-<id>` a `<acción>-hint-<id>`.
- **Pruebas:** `build`, `typecheck` y `npm test` bien (80 + 62). `test:ui` bien (8 de `ui.test.mjs`, con una nueva). `test:docker`: la prueba nueva de `resetProjectData` (borra volúmenes y contenedores, conserva carpeta, imagen y carpetas montadas, y el siguiente encendido empieza vacío) pasa con Docker real.
- **Pendientes y riesgos:** ninguno conocido. Un proyecto que guarda su base en una carpeta montada no se reinicia con esto; quedó escrito en el manual y en los límites conocidos.

### 2. Espacio en disco

- **Estado:** terminada.
- **Commit:** ver la lista de commits al final.
- **Decisiones que se apartaron del plan:**
  - Se comprobó con Docker real (29.10, Compose 5.7) en los dos almacenes de imágenes. En el clásico (overlay2), compose etiqueta las imágenes que construye y las versiones viejas quedan sin nombre pero **conservan** la etiqueta, así que se atribuyen con seguridad. En el de containerd (el que traen por defecto las instalaciones nuevas de Docker 29), la versión anterior desaparece sola al reconstruir: no hay versiones viejas que liberar y lo que ocupa queda en la caché de construcción. Quedó anotado en los límites conocidos.
  - «Versión vieja» es una imagen etiquetada del proyecto, **sin nombre** y que ningún contenedor usa. El plan decía «que no use ningún contenedor»; se agregó «sin nombre» para no borrar la imagen actual de un proyecto que se quedó sin contenedores tras **Reiniciar datos** (la función 1 promete que el siguiente encendido no reconstruye).
  - Las imágenes descargadas (`image: postgres`) no llevan la etiqueta de compose y no se atribuyen a ningún proyecto, ni se cuentan ni se borran.
  - `freedBytes` es cuánto bajó el total de imágenes de `docker system df` antes y después; las versiones viejas de la tabla usan `UniqueSize`, así que la estimación de la confirmación puede diferir un poco de lo liberado.
  - La API quedó en un servicio y unas rutas propias (`api/src/services/disk.ts`, `api/src/routes/disk.ts`) y la interfaz en `web/src/scripts/settings/disk.ts`.
- **Pruebas:** `build`, `typecheck` y `npm test` bien (83 + 67, con 3 unitarias del núcleo y 5 de la API nuevas). `test:ui` de Configuración bien (6, con 2 nuevas). `test:docker`: la prueba nueva de `pruneProjectImages` (borra solo la versión vieja del proyecto pedido, no toca la del otro proyecto ni los volúmenes, y conserva la imagen actual tras reiniciar datos) pasa con el almacén clásico.
- **Pendientes y riesgos:** no se libera la caché de construcción, que en la PC del usuario puede ser buena parte de los 15,5 GB recuperables; hacerlo exigiría `docker builder prune`, que es global. `docker system df -v` mide cada volumen y puede tardar con bases grandes (límite de 2 minutos).

### 3. Ficha enriquecida del proyecto

- **Estado:** terminada, sin el ícono automático (era opcional).
- **Commit:** ver la lista de commits al final.
- **Decisiones que se apartaron del plan:**
  - Se agregó la columna `image_version` (entero que sube con cada cambio de imagen) para el parámetro de versión de `imageUrl`; el plan no la listaba. Así el archivo sigue siendo `data/imagenes/<id>.<ext>` y el navegador no muestra la imagen anterior.
  - Al registrar, el nombre para mostrar por defecto es lo que escribió el docente en «Nombre del proyecto» («Tienda escolar»), no el nombre técnico normalizado («tienda-escolar»); en la migración sí es el nombre técnico, como pide el plan. El formulario de registro no tiene un campo aparte para el nombre para mostrar: se cambia después en la ficha.
  - El formulario de registro ganó el campo **Año** (el actual por defecto, y se conserva entre registros seguidos). Al usar el nombre sugerido, lo escrito queda como nombre para mostrar.
  - `PATCH /api/projects/:id` valida con `Value.Check`, que no quita claves desconocidas (no pasa por el esquema de Fastify), así que una clave desconocida ya responde 400; no hizo falta el truco de `PATCH /api/settings`.
  - Un correo o teléfono vacío de un contacto se acepta y no se guarda, para que la interfaz pueda mandar filas a medio llenar.
  - El teléfono de un contacto también es un enlace `tel:`.
  - Para compartir el avatar entre páginas, los ayudantes `element` e `isSelectingIn` pasaron de `projects/dom.ts` a `projects/element.ts` (`dom.ts` los reexporta): `dom.ts` exige los elementos de la página de Proyectos al importarse.
  - El encendido desde la ficha no muestra el avance de Docker línea por línea (eso sigue en la lista); muestra «Encendiendo…» y el error si falla.
- **Pruebas:** `build`, `typecheck` y `npm test` bien (83 + 76; 9 pruebas nuevas de la API en `api/test/details.test.ts`: valores por defecto, sugerencia de nombre, validación de cada campo, búsqueda y años, firma de bytes, subir/servir/cambiar/borrar la imagen, rechazo de SVG y de más de 2 MB, borrado al eliminar y migración de una base anterior). `test:ui` bien (28 y 1 omitida; nuevas: `web/test/project.test.mjs` con 6 pruebas de la ficha, y 2 en `ui.test.mjs` para el enlace a la ficha y la sugerencia de nombre al registrar). No toca Docker.
- **Pendientes y riesgos:** el ícono automático del proyecto (opcional) no se hizo. La ficha refresca su estado cada 15 s, no cada 2 s como la lista mientras enciende.

### 4. Vista en cuadrícula o tabla y carpetas por año

- **Estado:** terminada.
- **Commit:** ver la lista de commits al final.
- **Decisiones que se apartaron del plan:**
  - `GET /api/projects/years` agrega `running` (cuántos encendidos tiene cada año). Sin eso, con la carpeta de un año abierta, «Apagar todos» no sabía si había algo encendido en otro año y podía quedar oculto. Usa la misma consulta única a Docker que la lista. Las carpetas también lo muestran («2 encendidos»).
  - El valor por defecto de `projectsView` se decide y **se guarda** la primera vez que arranca esta versión (`table` si hay proyectos, `grid` si no). Si se calculara en cada lectura, una instalación nueva pasaría a tabla al registrar su primer proyecto.
  - Las piezas comunes salieron de `rows/project-row.ts` a `parts/` (`identity.ts`, `status.ts`, `ports.ts`, `controls.ts`, este último con el menú popover) y los paneles de avance, avisos y registro a `progressPanel`, `warningsPanel` y `logsPanel`; la fila y la tarjeta (`cards/project-card.ts`) solo los acomodan. Los registros en curso también tienen tarjeta (`cards/registration-card.ts`).
  - «Apagar todos» dice «Apagar todos (todos los años)» dentro de una carpeta y «Apagar todos» en «Todos»; la confirmación dice que incluye los de otros años.
  - Al registrar un proyecto de otro año, se abre su carpeta para que se vea.
  - Atrás y Adelante del navegador cambian de carpeta (`pushState` y `popstate`).
  - Se corrigió de paso un desborde horizontal a 320 px: la rejilla de 12 columnas con `gap-7` suma 11 separaciones que no caben. Proyectos y Configuración usan ahora `gap-y-* lg:gap-x-*`, y quedó la regla en `AGENTS.md`.
- **Pruebas:** `build`, `typecheck` y `npm test` bien (83 + 77, con una prueba nueva de la API para la vista por defecto y su guardado). `test:ui` bien (30 y 1 omitida; nuevas: cuadrícula con sus acciones, menú y foco tras refrescar, registro dentro de la tarjeta, sin desplazamiento horizontal de 320 a 1440 px y preferencia guardada; carpetas con el año más reciente por defecto, URL, buscar en todos, Atrás y recarga). Se revisaron capturas de la tabla y la cuadrícula a 1440 y 390 px.
- **Pendientes y riesgos:** en tarjetas angostas, el botón ⋯ baja a una segunda línea junto a Encender/Apagar y Abrir; funciona, pero ocupa más alto.

### 5. Registrar varios proyectos a la vez

- **Estado:** terminada.
- **Commit:** ver la lista de commits al final.
- **Decisiones que se apartaron del plan:**
  - El registro de la API se separó en `reserve` (reserva el nombre y lo pone en la lista) y `prepare` (descarga, revisa y guarda), que usan el registro de uno y la cola. La cola reserva todos los nombres al recibir la tanda, con la etapa «En espera»: así un nombre encolado no se puede registrar por otro lado y `busy()` cuenta la tanda entera (no deja actualizar Dockyard ni liberar espacio a mitad).
  - Un registro de uno, desde el formulario de siempre, no espera a la cola: corre como antes, en paralelo.
  - Límite de 60 proyectos por tanda.
  - `POST /api/projects/batch` valida las URL una por una y devuelve las malas en `rejected` en vez de responder 400 a toda la tanda.
  - La vista previa repite en la interfaz la normalización del nombre del núcleo, solo para avisar de repetidos antes de enviar; para saber qué nombres existen pide `GET /api/projects?year=todos` al abrir «Varios».
  - El campo de año de «Varios» se aplica a los ZIP también.
  - Mientras se suben los ZIP, la pestaña pide confirmar antes de cerrarse (`beforeunload`), además del aviso escrito.
- **Pruebas:** `build`, `typecheck` y `npm test` bien (83 + 80; nuevas en `api/test/batch.test.ts`: una tanda con líneas válidas e inválidas registra solo las válidas, en orden y de a una, con el núcleo simulado y midiendo cuántas corren a la vez; reserva de nombres y `busy()`; tandas inválidas). `test:ui` bien (32 y 1 omitida; nuevas: vista previa con cada tipo de error y envío de solo las válidas; varios ZIP subidos de a uno con una falla).
- **Pendientes y riesgos:** la cola vive en memoria, como los registros: si Dockyard se reinicia a mitad (por ejemplo con `update.sh`), los que estaban en espera se pierden sin aviso y hay que volver a enviarlos. Actualizar desde la página no lo permite mientras hay una tanda, pero `update.sh` desde la terminal sí.

### 6. Mensajes claros sobre puertos

- **Estado:** terminada.
- **Commit:** ver la lista de commits al final.
- **Decisiones que se apartaron del plan:**
  - Se comprobó con Docker 29.10 real qué escribe con un programa que no es Docker en el puerto: `failed to bind host port 0.0.0.0:8094/tcp: address already in use` (distinto de las versiones anteriores, `listen tcp4 …: bind: address already in use`). `portInUseMessage` reconoce las tres formas. Para `port is already allocated`, que Docker usa cuando el puerto lo tiene **otro contenedor** (por ejemplo, uno que lo tomó entre la revisión y el encendido), el mensaje dice «otro contenedor de Docker de esta PC» en vez de «otro programa que no es un proyecto de Docker», que sería falso.
  - Tras ese error, `startProject` detiene los servicios que alcanzaron a arrancar, para que el proyecto no quede encendido a medias.
  - El campo opcional nuevo de `ProjectStatus` es `loopbackPorts` (puertos publicados solo en `127.0.0.1` o `::1`), y el estado nuevo de la web es `unchecked`. `createWebChecker` decide si puede alcanzarlos según su `PROJECTS_HOST`: fuera del contenedor (`localhost`) sí los comprueba.
  - `PortInUse` (de `portsInUse`) ganó el campo `host`, para que la lista (`docker ps`) también sepa en qué dirección se publicó cada puerto.
- **Pruebas:** `build`, `typecheck` y `npm test` bien (85 + 82; nuevas: las formas del mensaje de Docker con la salida real de Docker 29.10, qué puertos son solo de esta PC, el comprobador dentro y fuera del contenedor, y que la API le pasa esos puertos). `test:docker`: prueba nueva con un servidor de Node ocupando el puerto 8084 (mensaje en español, nada queda encendido) y, ya libre, `loopbackPorts: [8085]` igual por `getProjectStatus` y por `getProjectStatuses`. `test:ui` bien (33 y 1 omitida, con una nueva para el aviso).
- **Pendientes y riesgos:** si Docker cambia el texto del error, vuelve a llegar el mensaje de Docker en inglés. La red del contenedor de Dockyard no se tocó, como pide el plan.

### 7. Exportar e importar la lista de proyectos

- **Estado:** terminada.
- **Commit:** ver la lista de commits al final.
- **Decisiones que se apartaron del plan:**
  - La vista previa y la aplicación son dos rutas: `POST /api/import/preview` (no cambia nada) y `POST /api/import`, las dos con el mismo archivo. El plan nombraba solo `POST /api/import`.
  - Para «se pueden registrar después con su archivo, conservando la ficha importada», las fichas de ZIP se guardan en una tabla nueva, `pending_imports`, y se registran con `POST /api/import/pending/:name` (multipart) o se descartan con `DELETE`. Así sobreviven a cerrar la pestaña y a reiniciar Dockyard. Están en Configuración > Respaldo, «Esperan su ZIP».
  - El archivo lleva también `zipName` (el nombre del ZIP que se subió) como referencia para el docente.
  - `POST /api/import*` acepta hasta 100 MB (`bodyLimit` por ruta), por las imágenes en base64; el resto de la API sigue con 1 MB.
  - Además de los nombres que ya existen, se omiten los que se están registrando, los que ya esperan su ZIP y los repetidos dentro del archivo, para poder importar el mismo archivo dos veces sin duplicar nada.
  - Una imagen que no es PNG, JPEG o WebP por su firma se descarta; el resto de la ficha sí se importa.
  - Los esquemas compartidos de la ficha (año, nombre para mostrar, contactos y límites) pasaron a `api/src/routes/schemas.ts`.
- **Pruebas:** `build`, `typecheck` y `npm test` bien (85 + 86; nuevas en `api/test/backup.test.ts`: exportar con cada campo y la imagen; vista previa sin cambios; aplicar con registro por la cola con toda la ficha, ZIP pendiente y omitidos; importar dos veces; registrar y descartar un pendiente; archivos inválidos; un cuerpo de más de 1 MB). `test:ui` bien (35 y 1 omitida; nuevas: exportar, vista previa, importar, registrar un pendiente eligiendo su ZIP, y un archivo que no es JSON).
- **Pendientes y riesgos:** el archivo exportado lleva datos personales de estudiantes; la interfaz y `docs/privacidad.md` lo avisan, pero no se cifra.

## Resumen final

**Pull request:** https://github.com/N0Namesir/Dockyard/pull/2 (hacia `main`, sin fusionar).

Las 7 funciones quedaron terminadas, cada una en su commit, en este orden:

1. `1d6dd54` Reiniciar los datos de un proyecto sin eliminarlo
2. `edb5964` Espacio en disco: ver lo que ocupa cada proyecto y liberar versiones viejas
3. `a13f997` Ficha del proyecto: nombre para mostrar, año, descripción, contactos e imagen
4. `1d93d51` Vista en cuadrícula o tabla y carpetas por año
5. `601a296` Registrar varios proyectos a la vez
6. `e74cce1` Mensajes claros sobre puertos
7. `a9be4b6` Exportar e importar la lista de proyectos

No se publicó ninguna versión ni se ejecutaron `npm version`, `install.sh`, `update.sh` ni `scripts/publicar-release.sh`.

**Pruebas al final:** `npm run build`, `npm run typecheck` y `npm test` (85 del núcleo y 86 de la API) bien. `npm run test:ui -w web`: 35 bien y 1 omitida (la de capturas, que solo corre con `UI_SCREENSHOTS`), con Chromium 1243 en lugar del 1255 que pide el proyecto (ver «Entorno de la sesión» arriba). `npm run test:docker -w core` (completa, con el almacén de imágenes clásico de Docker): 32 bien, 2 omitidas (las de archivos de root, porque la sesión corre como root) y 1 falla ajena al código, la misma que antes de empezar: «prueba-bd» no pudo descargar `adminer` porque Docker Hub respondió `toomanyrequests` (límite de descargas sin sesión). Las pruebas nuevas con Docker (reiniciar datos, versiones viejas, puerto ocupado por otro programa y `loopbackPorts`) pasan. Conviene correr «prueba-bd» en la PC del usuario.

**Conviene revisar primero:**

1. **Ficha y migración de la base (función 3).** Agrega siete columnas a `projects` con migración; conviene probarla con la `data/app.db` real antes de publicar (respaldarla primero). También reemplaza el diálogo rápido de editar por la página `/proyecto/`.
2. **Espacio en disco (función 2).** Revisar en la PC del usuario qué almacén de imágenes usa Docker (`docker info | grep -i storage`): con el de containerd no hay versiones viejas que liberar, y los 15,5 GB recuperables están sobre todo en la caché de construcción, que esta función no toca a propósito.
3. **Cola de registros (funciones 5 y 7).** Vive en memoria: `update.sh` desde la terminal a mitad de una tanda pierde los que estaban en espera.
4. **Carpetas por año (función 4).** Al abrir Proyectos ahora se ve el año más reciente, no todos; «Apagar todos» sigue apagando todo.
5. **Privacidad.** Contactos de estudiantes en la base, imágenes en `data/imagenes/` y el archivo exportado: revisar el texto de `docs/privacidad.md`.
