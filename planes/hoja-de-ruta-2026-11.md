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
