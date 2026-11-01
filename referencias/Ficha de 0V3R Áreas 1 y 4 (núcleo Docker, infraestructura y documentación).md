# Dockyard · Ficha de 0V3R: Áreas 1 y 4 (núcleo Docker, infraestructura y documentación)

Oct 31, 2026 · @Eduardo Rivas

## Resumen

0V3R construye el núcleo de Dockyard que ejecuta Docker (Área 1) y todo lo que rodea al proyecto: repositorio, despliegue, proyectos de prueba y documentación (Área 4). Isaac construye la API y la interfaz sobre el contrato que el núcleo implementa.

Dos entregas pesan más que las demás. La base del repositorio, porque Isaac la necesita desde el domingo por la mañana. Y el núcleo real, que Isaac debe tener a más tardar el lunes por la mañana para reemplazar su versión simulada. Los documentos y la instalación se pueden ajustar sobre la marcha.

En una frase: el núcleo recibe una carpeta o una fuente y deja que `git`, `unzip` y `docker compose` hagan el trabajo. Nunca habla con HTTP ni con la base de datos.

## Qué recibe y qué entrega

Las fechas son orientativas y sirven para saber cuándo reclamar o avisar.

| Qué | De quién a quién | Para qué | Cuándo |
| --- | --- | --- | --- |
| Base del repositorio y acceso para Isaac | 0V3R a Isaac | Que tenga dónde trabajar sin pelear con la configuración | Domingo, primer paso |
| `normalizeProjectName` y las cuatro funciones del contrato, implementadas en `core/` | 0V3R a Isaac | Reemplazar la versión simulada | A más tardar el lunes por la mañana |
| Proyectos de prueba con compose | 0V3R a Isaac | Probar el registro, el encendido y el apagado | Lunes por la mañana |
| Herramienta lista para arrancar con un comando | 0V3R al equipo | Integración y prueba en la PC del docente | Lunes por la tarde |
| API con las rutas del contrato | Isaac a 0V3R | Probar de punta a punta | Domingo por la noche |
| Interfaz conectada a la API | Isaac a 0V3R | Integración y pruebas finales | Lunes por la tarde |
| Notas breves del área de Isaac | Isaac a 0V3R | Armar la guía técnica y el manual | Lunes |
| Guía técnica y manual de usuario | 0V3R al docente y al próximo grupo | Entrega | Lunes por la noche o martes |

## Primer paso: la base del repositorio

Isaac puede arrancar con su propia estructura, pero perderá tiempo si la tuya llega tarde. Por eso esto va antes que cualquier función del núcleo y debería tomar menos de una hora.

```
/
├─ core/                Área 1 (0V3R): núcleo Docker y fuentes
├─ api/                 Área 2 (Isaac): servidor Fastify y base de datos
├─ web/                 Área 3 (Isaac): interfaz con Astro y Tailwind
├─ docs/                Área 4 (0V3R): guía técnica y manual
├─ projects/            proyectos registrados (no se sube a git)
├─ data/                base de datos SQLite (no se sube a git)
├─ Dockerfile           Área 4 (0V3R)
└─ docker-compose.yml   Área 4 (0V3R)
```

- [ ] Crear el repositorio en la organización de GitHub y dar acceso a Isaac.
- [ ] Crear la estructura de carpetas de arriba.
- [ ] Configurarlo como monorepo con workspaces de npm, un `tsconfig` base compartido y los scripts `dev`, `build` y `start`.
- [ ] Agregar un `.gitignore` con `node_modules`, `projects/`, `data/`, `.env` y las carpetas compiladas.
- [ ] Dejar en `core/` un archivo `index.ts` con las firmas del contrato y funciones que lancen el error "No implementado", para que Isaac pueda importarlo desde el primer día.
- [ ] Escribir un README mínimo: cómo clonar, instalar y arrancar en desarrollo.
- [ ] Acordar con Isaac el flujo de git: una rama por persona y cambios pequeños. Como las carpetas son distintas, casi no habrá conflictos.

## Contrato del núcleo

Estas son las firmas que 0V3R implementa en `core/` y que Isaac usa tal cual. No cambian sin acuerdo entre los dos. Respecto a la ficha de Isaac se suma `normalizeProjectName`, porque la API necesita el nombre normalizado antes de llamar a `prepareProject` para poder responder 409 sin esperar un clonado.

```ts
export type ProjectState = 'running' | 'stopped'
export interface ProjectStatus { state: ProjectState; ports: number[] }
export type ProjectSource =
  | { type: 'git'; url: string }
  | { type: 'zip'; filePath: string }
export interface PreparedProject { dir: string; name: string }

normalizeProjectName(name: string): string
prepareProject(source: ProjectSource, name: string): Promise<PreparedProject>
startProject(dir: string, name: string): Promise<ProjectStatus>
stopProject(dir: string, name: string): Promise<ProjectStatus>
getProjectStatus(name: string): Promise<ProjectStatus>
```

| Función | Qué hace | Usa | Falla cuando |
| --- | --- | --- | --- |
| `normalizeProjectName` | Convierte un nombre libre en uno válido para docker compose. No toca el disco | Nada | Nunca falla; si el resultado queda vacío devuelve `proyecto` |
| `prepareProject` | Crea `projects/<nombre>`, obtiene el código, ubica el archivo compose y devuelve la carpeta que lo contiene | `git`, `unzip` | La carpeta ya existe; la URL no es HTTPS; el clonado o la descompresión fallan; no hay archivo compose |
| `startProject` | Revisa choques de puertos y enciende el proyecto | `docker compose up -d` | Un puerto está en uso; Docker no responde; el compose falla |
| `stopProject` | Apaga el proyecto sin borrar sus contenedores | `docker compose stop` | Docker no responde |
| `getProjectStatus` | Dice si el proyecto corre y en qué puertos | `docker compose ps --format json` | Docker no responde |

**Errores.** Toda falla se lanza como un `Error` con un mensaje en español que diga la causa y, si se puede, qué hacer. Ejemplo: `El puerto 8081 ya está en uso por el contenedor prueba-estatico-web-1. Apaga ese proyecto o cambia el puerto en el compose.` La API devuelve ese texto al docente tal cual.

## Nombres, carpetas y obtención del código

**Normalización del nombre.** Docker compose exige que el nombre del proyecto use solo minúsculas, dígitos, guiones y guiones bajos, y que empiece con una letra minúscula o un dígito. Las reglas, en orden:

1. Pasar a minúsculas y quitar las tildes.
2. Reemplazar cualquier carácter fuera de `a-z`, `0-9`, `-` y `_` por un guion.
3. Juntar guiones repetidos y quitar los del inicio y el final.
4. Si el resultado queda vacío, usar `proyecto`.

| Entrada | Resultado |
| --- | --- |
| `Tienda Equipo 3` | `tienda-equipo-3` |
| `Álvarez & Co.` | `alvarez-co` |
| `Mi_App 2` | `mi_app-2` |
| `---` | `proyecto` |

**Carpeta del proyecto.** Se crea en `projects/<nombre>`, dentro de la ruta que indique la variable de entorno `PROJECTS_DIR` (por defecto, la carpeta `projects/` del repositorio). Si ya existe, `prepareProject` falla con el mensaje `Ya existe un proyecto con ese nombre`.

**Ubicar el compose.** Después de obtener el código, se busca en la raíz, en este orden: `compose.yaml`, `compose.yml`, `docker-compose.yaml`, `docker-compose.yml`. Si no hay ninguno y la raíz contiene una sola carpeta (típico de un ZIP armado desde una carpeta), se busca ahí. Si tampoco aparece, falla con `No se encontró un archivo compose en la raíz del proyecto`. La carpeta donde se encontró es la `dir` que se devuelve.

**Desde GitHub**

- Solo se aceptan URL que empiecen con `https://`.
- Comando: `git clone --depth 1 -- <url> <carpeta>`, ejecutado con `execFile` y una lista de argumentos, nunca armando una cadena para un shell.
- Se define la variable `GIT_TERMINAL_PROMPT=0` para que un repositorio privado falle de inmediato en lugar de quedarse esperando usuario y contraseña. Los repositorios privados no se admiten en esta versión y el mensaje de error lo dice.
- Se conserva la carpeta `.git` para poder actualizar con `git pull` más adelante.

**Desde un ZIP**

- Comando: `unzip -q <archivo> -d <carpeta>`, también con `execFile`. Requiere el paquete `unzip` en la laptop y en la imagen de la herramienta.
- El núcleo no borra el ZIP: lo creó la API, así que la API lo borra al terminar.

**Después de obtener el código**

- Si existe `.env.example` y no existe `.env`, se copia como `.env`. Los valores de ejemplo suelen bastar para encender el proyecto.
- **Si algo falla a mitad de camino, se borra la carpeta que se creó**, para que el docente pueda reintentar sin quedar con un proyecto a medias.

**Ayudante para ejecutar comandos**

```ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export async function run(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number } = {}) {
  try {
    const { stdout } = await execFileAsync(cmd, args, {
      cwd: opts.cwd,
      timeout: opts.timeoutMs ?? 120_000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    })
    return stdout
  } catch (err: any) {
    const detail = String(err.stderr || err.message).trim().split('\n').slice(-5).join('\n')
    throw new Error(`${cmd} falló: ${detail}`)
  }
}
```

## Encender, apagar y consultar el estado

Los tres comandos comparten el mismo prefijo, para que no dependan de la carpeta desde la que corre la herramienta:

```
docker compose -p <nombre> --project-directory <dir> -f <dir>/<archivo-compose>
```

`-p` fija el nombre del proyecto y `--project-directory` fija la carpeta de trabajo. El archivo se vuelve a ubicar con la misma búsqueda de la sección anterior.

| Función | Comando que se agrega al prefijo | Tiempo máximo | Notas |
| --- | --- | --- | --- |
| `startProject` | `up -d` | 10 minutos | La primera vez Docker descarga imágenes y puede construir las propias; es normal que tarde |
| `stopProject` | `stop` | 2 minutos | Detiene los contenedores sin borrarlos, así encender de nuevo es rápido |
| `getProjectStatus` | `ps --format json (con -p, sin -f)` | 30 segundos | Solo lista contenedores en ejecución |

**Por qué `stop` y no `down`.** `stop` detiene los contenedores sin eliminar nada. `down` elimina contenedores y redes, aunque conserva los volúmenes con nombre. Para un botón de apagar que se usa seguido, `stop` es más rápido y más seguro.

**Leer el estado.** `ps --format json` devuelve un objeto JSON por línea, con campos como `State` y `Publishers` (una lista con `PublishedPort`). Algunas versiones antiguas devolvían un arreglo, así que conviene aceptar ambas formas:

```ts
function parsePs(out: string): any[] {
  const text = out.trim()
  if (!text) return []
  if (text.startsWith('[')) return JSON.parse(text)
  return text.split('\n').map((line) => JSON.parse(line))
}
```

- `state` es `running` si algún contenedor tiene `State` igual a `running`; si no hay ninguno, es `stopped`.
- `ports` es la lista, sin repetidos y ordenada, de los `PublishedPort` mayores que 0.

**Después de encender.** `startProject` consulta el estado y lo devuelve. Si el estado es `stopped` (los contenedores arrancaron y se cayeron), lanza un error que incluya las últimas líneas de `docker compose logs --tail 20`, que es lo que más ayuda a diagnosticar un proyecto de estudiantes.

**Para comprobar el domingo, antes de depender de ello**

- Que `docker compose -p <nombre> ps --format json` funcione sin indicar el archivo compose. Si no, usar `docker ps --filter label=com.docker.compose.project=<nombre> --format json`, que no depende del archivo.
- La forma exacta de la salida en la versión de Docker de la laptop y en la de la PC del docente.

## Puertos

Cada proyecto de estudiantes publica sus propios puertos en la PC del docente, y dos proyectos no pueden usar el mismo puerto a la vez. Esta entrega **detecta el choque y avisa; no reescribe los puertos.**

**Por qué no se reescriben.** Los proyectos de estudiantes suelen apuntar a sus propios puertos. Un frontend que llama a `http://localhost:5000` dejaría de funcionar si se cambia el puerto del backend. Reescribir arreglaría el choque y rompería la aplicación.

**Cómo se detecta, dentro de `startProject` y antes de `up -d`**

1. Obtener los puertos que el proyecto quiere publicar con `config --format json`, que muestra el modelo ya resuelto del compose. Los puertos están bajo `services.<servicio>.ports`.
2. Obtener los puertos que ya usan los contenedores en ejecución con `docker ps --format json`. El campo `Ports` es un texto como `0.0.0.0:8080->80/tcp`; con una expresión regular que capture el número antes de `->` basta. El campo `Names` da el nombre del contenedor.
3. Si algún puerto pedido ya está en uso, lanzar el error de ejemplo del contrato, que nombra el contenedor que lo ocupa.
4. Si el compose no publica puertos fijos (solo `80`, o un rango como `8000-8010`), se omite esta revisión y se deja que Docker resuelva.

**Lo que esta revisión no ve.** Un proceso de la PC que no sea Docker y use el puerto. En ese caso Docker falla al ejecutar `up -d` con un error de puerto ocupado, y ese mensaje llega al docente tal cual. Está bien para esta entrega.

**Para comprobar el domingo.** La forma exacta de `ports` en la salida de `config --format json` (nombres de los campos y si el puerto publicado viene como texto o como número) se confirma con un ejemplo real antes de escribir el código.

**Puerto de la propia herramienta.** Los proyectos de estudiantes usan con mucha frecuencia el 3000, el 5173 o el 8080. La herramienta debe correr en un puerto poco común, por ejemplo el 4300, configurable con `TOOL_PORT`. Hay que avisar a Isaac, porque sus ejemplos de `curl` usan el 3000.

**Queda para el próximo grupo.** La reescritura automática de puertos y los subdominios con Traefik.

## Despliegue de la herramienta

La herramienta corre en un contenedor y habla con el Docker del anfitrión a través de su socket. Los proyectos de estudiantes no quedan dentro de ella: son contenedores hermanos en el mismo anfitrión. Por eso sus puertos se publican en la PC del docente y `http://localhost:<puerto>` funciona desde su navegador.

**Dockerfile, en dos etapas**

1. Etapa de compilación: una imagen de Node con la versión que se confirme tras probar node:sqlite; `npm ci` y `npm run build`, que compila `core`, `api` y `web`.
2. Etapa final: otra imagen de Node que instala `git`, `unzip`, el cliente de Docker (`docker-ce-cli`) y el complemento de compose (`docker-compose-plugin`) desde el repositorio oficial de Docker; copia lo compilado; expone el puerto de la herramienta y arranca con `npm run start`.

Los comandos exactos para agregar el repositorio de Docker dentro de la imagen se toman de la documentación oficial de instalación de Docker para la distribución de la imagen base. Hay que verificarlos al escribir el archivo.

**docker-compose.yml de la herramienta (boceto)**

```yaml
services:
  app:
    build: .
    restart: unless-stopped
    ports:
      - "${TOOL_PORT:-4300}:${TOOL_PORT:-4300}"
    environment:
      PORT: ${TOOL_PORT:-4300}
      PROJECTS_DIR: ${PROJECTS_DIR}
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ${PROJECTS_DIR}:${PROJECTS_DIR}
      - ./data:/app/data
```

**La regla más importante: la ruta de `projects/` debe ser la misma dentro y fuera del contenedor.** Fíjate en la línea `${PROJECTS_DIR}:${PROJECTS_DIR}`. Cuando un proyecto de estudiantes monta una carpeta relativa (`./src:/app`), el Docker del anfitrión la resuelve con la ruta que le llegó. Si dentro del contenedor la carpeta se ve en otra ruta que en el anfitrión, esos montajes apuntan a un lugar que no existe. Dockge documenta esta misma regla para sus carpetas de stacks.

**Variables del archivo `.env`**, que genera el script de instalación:

- `PROJECTS_DIR`: ruta absoluta de la carpeta `projects/` en el anfitrión.
- `TOOL_PORT`: puerto de la herramienta, poco común para no chocar con los proyectos.

**Permisos.** El contenedor corre como `root`, así que puede usar el socket sin más. La consecuencia es que los archivos que crea en `projects/` y `data/` quedan como propiedad de `root` en la PC. Si eso estorba (por ejemplo, para borrar una carpeta a mano), se puede ejecutar el contenedor con el UID y GID del usuario y agregarle el grupo del socket con `group_add`. Se resuelve solo si molesta.

**Script de instalación (`install.sh`)**

- [ ] Comprobar que existen `docker` y `docker compose`, y mostrar sus versiones.
- [ ] Crear `projects/` y `data/` si no existen.
- [ ] Escribir `.env` con la ruta absoluta de `projects/` y el puerto.
- [ ] Ejecutar `docker compose up -d --build`.
- [ ] Imprimir la dirección en la que quedó disponible la herramienta.

**Después de reiniciar la PC.** `restart: unless-stopped` hace que la herramienta vuelva sola, siempre que el servicio de Docker arranque con el sistema. Se comprueba reiniciando la PC, no se da por hecho.

**En la laptop, durante el desarrollo**, no hace falta el contenedor: se corre con `npm run dev` y la herramienta usa el Docker de la laptop directamente. Solo se necesita tener instalados `docker`, `docker compose`, `git` y `unzip`.

**Plan B.** Si el lunes aparece un problema con la ejecución en contenedor (rutas, permisos) que no se resuelve rápido, la herramienta se puede correr directamente en la PC con Node y PM2. El código no cambia; solo cambia cómo se arranca. Requiere Node, `git`, `unzip` y Docker en la PC. La decisión se toma a más tardar el lunes al mediodía, para no llegar al martes sin una opción que funcione.

## Proyectos de prueba

Cuatro proyectos pequeños cubren los casos que importan. Se guardan en un repositorio público de la organización, uno por carpeta, y también como ZIP, para probar las dos formas de entrega.

| Proyecto | Qué cubre | Puerto |
| --- | --- | --- |
| `prueba-estatico` | El caso más simple: una imagen lista para usar | 8081 |
| `prueba-bd` | Una aplicación web con una base de datos y un volumen | 8082 |
| `prueba-build` | Un servicio que construye su propia imagen con `build:` y un Dockerfile | 8083 |
| `prueba-conflicto` | Copia de `prueba-estatico` que publica también el 8081, para probar la detección de puertos | 8081 |

```yaml
# prueba-estatico/compose.yaml
services:
  web:
    image: nginx:alpine
    ports:
      - "8081:80"
```

```yaml
# prueba-bd/compose.yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: ejemplo
    volumes:
      - datos:/var/lib/postgresql/data
  adminer:
    image: adminer
    ports:
      - "8082:8080"
volumes:
  datos:
```

`prueba-build` es un servidor HTTP de pocas líneas en Node con su Dockerfile, publicado en `8083:3000`.

**Variantes de ZIP que también hay que probar**

- Un ZIP con el archivo compose en la raíz.
- Un ZIP con una carpeta intermedia (el compose queda un nivel más abajo).
- Un ZIP sin ningún archivo compose, que debe fallar con el mensaje esperado y sin dejar carpetas a medias.

## Documentación

Se escribe en Markdown dentro de `docs/`. Si el profesor pide otro formato, se convierte al final. Tres documentos:

**Guía técnica (`docs/guia-tecnica.md`)**, pensada para el grupo que herede el proyecto:

- Qué es la herramienta y cómo se divide (núcleo, API, interfaz).
- Estructura de carpetas y a quién corresponde cada una.
- Cómo arrancar en desarrollo en una laptop.
- Cómo se despliega en la PC del docente.
- El contrato entre el núcleo y la API, y cómo agregar una función nueva.
- Decisiones tomadas y por qué: `docker compose stop` en lugar de `down`, detección de puertos sin reescritura, SQLite con `node:sqlite`.
- Límites conocidos y mejoras sugeridas (ver el final de esta ficha).

**Manual de usuario (`docs/manual-usuario.md`)**, para el docente:

- Cómo abrir la herramienta.
- Cómo registrar un proyecto por repositorio y por ZIP.
- Cómo buscar, encender, apagar y abrir un proyecto.
- Problemas frecuentes y qué hacer: puerto ocupado, Docker apagado, un proyecto que tarda mucho la primera vez, un proyecto que se enciende y se cae.

**Requisitos para proyectos de estudiantes (`docs/requisitos-proyectos.md`)**, un documento corto que el docente puede repartir:

- El archivo compose va en la raíz, con el nombre `compose.yaml` o `docker-compose.yml`.
- Cada servicio usa una imagen publicada o un `build:` con su Dockerfile.
- La base de datos va dentro del mismo compose, con un volumen.
- Si el proyecto necesita variables, incluye un `.env.example` con valores que funcionen.
- Los puertos publicados deben ser poco comunes y distintos de los de otros equipos.
- En un ZIP no se incluyen `node_modules` ni `.git`.
- El repositorio debe ser público.

Las notas breves que Isaac deje de su área alimentan la guía técnica y el manual.

## Plan por día

El orden pone primero lo que bloquea a Isaac y deja al final lo que se puede ajustar. Si algo se atrasa, se recorta de abajo hacia arriba dentro de cada día.

### Domingo por la mañana

- [ ] Hacer el primer paso completo (la base del repositorio) y avisar a Isaac.
- [ ] Avisar a Isaac del cambio de puerto (4300) y de la función `normalizeProjectName`.
- [ ] Verificar en la laptop que están instalados `docker`, `docker compose`, `git` y `unzip`.
- [ ] Probar a mano `ps --format json` y `config --format json` con un proyecto de prueba, y confirmar que `ps` funciona con `-p` y sin archivo compose.
- [ ] Crear los cuatro proyectos de prueba.

### Domingo por la tarde

- [ ] Escribir el ayudante `run` y `normalizeProjectName`.
- [ ] Implementar `getProjectStatus`, `startProject` y `stopProject`, y probarlos con los proyectos de prueba.
- [ ] Implementar `prepareProject` para repositorio y para ZIP, con la limpieza de carpeta cuando falla.
- [ ] Escribir el script de prueba del núcleo (ver la sección de pruebas).

### Domingo por la noche

- [ ] Publicar el núcleo en la rama y avisar a Isaac.
- [ ] Empezar el `Dockerfile` y el `docker-compose.yml` de la herramienta.

### Lunes por la mañana

- [ ] Agregar la revisión de puertos a `startProject`.
- [ ] Dejar funcionando la herramienta en contenedor en la laptop, con la ruta idéntica dentro y fuera.
- [ ] Escribir `install.sh`.
- [ ] Ayudar a Isaac a cambiar el núcleo simulado por el real.

### Lunes por la tarde

- [ ] Integración y pruebas de punta a punta con los cuatro proyectos de prueba.
- [ ] Prueba de instalación en la PC del docente si se puede acceder a ella; si no, en una máquina limpia con Ubuntu.
- [ ] Decidir, a más tardar al mediodía, si se mantiene el contenedor o se pasa al plan B.
- [ ] Recibir las notas de Isaac y empezar la guía técnica y el manual.

### Lunes por la noche

- [ ] Terminar y revisar los tres documentos de `docs/`.

### Martes

- [ ] Clonar el repositorio en la PC del docente e instalar con `install.sh`.
- [ ] Prueba final con los proyectos de prueba, por repositorio y por ZIP.
- [ ] Entrega.

## Cómo probar y cuándo está terminado

**Probar el núcleo sin la API.** Un script en `core/` (por ejemplo `core/try.ts`) que recibe la ruta de un proyecto de prueba y ejecuta en orden: `prepareProject`, `getProjectStatus`, `startProject`, `getProjectStatus`, `stopProject` y `getProjectStatus`, mostrando el resultado de cada paso. Así se prueba todo el núcleo sin depender de Isaac. La prueba de choque de puertos se hace encendiendo `prueba-estatico` y luego `prueba-conflicto`.

El trabajo está terminado cuando se cumple todo esto:

- [ ] `normalizeProjectName` convierte los ejemplos de la tabla como se espera.
- [ ] `prepareProject` funciona con un repositorio público, con un ZIP con el compose en la raíz y con un ZIP con una carpeta intermedia.
- [ ] Si `prepareProject` falla (sin compose, ZIP dañado, URL no válida), no deja carpetas a medias.
- [ ] `startProject` enciende cada proyecto de prueba y `getProjectStatus` devuelve `running` con los puertos esperados.
- [ ] Con el puerto ocupado por otro proyecto, `startProject` falla con un mensaje que nombra al otro contenedor.
- [ ] `stopProject` apaga el proyecto y `getProjectStatus` devuelve `stopped`.
- [ ] Todos los errores llegan como `Error` con un mensaje legible en español.
- [ ] La herramienta arranca con un comando (`install.sh`) en una máquina limpia con Ubuntu.
- [ ] Tras reiniciar la PC, la herramienta vuelve a estar disponible.
- [ ] Un proyecto de prueba con `build:` se enciende desde cero, y uno con base de datos conserva sus datos después de apagar y encender.
- [ ] Los tres documentos están en `docs/` y un tercero podría seguirlos sin preguntar.

## Límites, higiene mínima y qué queda para después

**Si te encuentras haciendo esto, para y avisa a Isaac**

- Escribir rutas de la API, guardar datos en SQLite o dibujar pantallas. Eso es del Área 2 o del Área 3.
- Cambiar archivos de `api/` o `web/` sin avisar a su responsable.
- Cambiar las firmas del contrato sin acordarlo.

**Higiene mínima que sí se hace.** Cuesta poco y no se negocia:

- Ejecutar siempre los comandos con `execFile` y una lista de argumentos; nunca armar una cadena para un shell con datos del docente.
- Usar solo nombres normalizados para carpetas y proyectos.
- Aceptar solo URL `https://` en los repositorios.
- Borrar las carpetas que quedan a medias cuando algo falla.
- Devolver mensajes de error claros.

**Queda documentado para el próximo grupo.** No se hace en esta entrega y va en la guía técnica como mejora:

- Validar los compose antes de encender: modo privilegiado, montajes de rutas del sistema y acceso al socket de Docker. `dclint` cubre otras reglas, pero no estas.
- Proteger la descompresión de ZIP contra archivos que escriban fuera de la carpeta o que ocupen un tamaño enorme.
- Admitir repositorios privados.
- Reescribir puertos automáticamente o usar subdominios con Traefik.
- Limitar los recursos de cada proyecto.
- Login para el docente.

Mientras tanto, el docente registra solo proyectos que conozca.

**Cuándo avisar a Isaac**

- Si cambia una firma del contrato o la forma de un error.
- Si encender un proyecto tarda más de lo esperado, porque afecta lo que la interfaz muestra mientras espera.
- Si el núcleo real no va a estar el lunes por la mañana.
