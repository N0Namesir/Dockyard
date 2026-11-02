# Dockyard · Ficha de Isaac: Áreas 2 y 3 (API, datos e interfaz)

**Fecha:** 31 de octubre de 2026

**Autor:** @Someone

## Resumen

Isaac construye la capa web de Dockyard: la API con su base de datos (**Área 2**) y la interfaz (**Área 3**). Trabaja en paralelo con **0V3R**, que construye el núcleo Docker y la infraestructura (**Áreas 1 y 4**).

Los dos se conectan por un contrato de rutas y funciones, que está en el documento de visión. Hasta que el trabajo real de 0V3R esté listo, Isaac usa una versión simulada, así que ninguno espera al otro. La integración real es el lunes por la tarde y la entrega es el martes.

**En una frase:** la API registra proyectos, los guarda, los lista y pide al núcleo Docker que los encienda o apague; la interfaz muestra todo eso y ofrece los botones. Ninguna de las dos ejecuta Docker.

## Qué recibe y qué entrega

Las fechas son orientativas y sirven para saber cuándo reclamar o avisar.

| Qué | De quién a quién | Para qué | Cuándo |
|---|---|---|---|
| Estructura base del repositorio y configuración de TypeScript | 0V3R a Isaac | Tener dónde trabajar sin pelear con la configuración | Domingo, al empezar |
| Funciones reales del núcleo Docker, incluida `normalizeProjectName` | 0V3R a Isaac | Reemplazar la versión simulada | A más tardar el lunes por la mañana |
| Proyectos de prueba con compose | 0V3R a Isaac | Probar el registro, el encendido y el apagado | Lunes por la mañana |
| API con las rutas del contrato | Isaac a 0V3R | Probar de punta a punta | Domingo por la noche |
| Interfaz conectada a la API | Isaac a 0V3R | Integración y pruebas finales | Lunes por la tarde |
| Notas breves del área (qué hace y cómo se prueba) | Isaac a 0V3R | Armar la guía técnica y el manual | Lunes |

## Estructura de carpetas

Isaac trabaja solo dentro de `api/` y `web/`. 0V3R deja la estructura base lista al empezar; esta es la propuesta.

```text
/
├─ api/                 Isaac (Área 2): servidor Fastify y base de datos
│  └─ src/
│     ├─ routes/        rutas del contrato
│     ├─ services/      lógica que une la base de datos y el núcleo Docker
│     ├─ db/            conexión y esquema de SQLite
│     └─ core-stub.ts   versión simulada del núcleo Docker
├─ web/                 Isaac (Área 3): interfaz con Astro y Tailwind
├─ core/                0V3R (Área 1): núcleo Docker y fuentes. No se toca
├─ projects/            proyectos registrados (no se sube a git)
├─ data/                base de datos SQLite (no se sube a git)
├─ docs/                0V3R (Área 4): guía técnica y manual
└─ docker-compose.yml   0V3R (Área 4): despliegue de la herramienta
```

Si algo de esta estructura estorba, se habla con 0V3R antes de mover carpetas.

## Modelo de datos

La base guarda solo lo que no se puede averiguar en Docker. El estado y los puertos se consultan siempre al núcleo Docker y nunca se guardan, para que no se desincronicen.

| Columna | Tipo | Qué guarda |
|---|---|---|
| `id` | Entero, clave primaria | Identificador que usan las rutas |
| `name` | Texto, único | Nombre normalizado del proyecto, el mismo que usa docker compose |
| `team` | Texto | Nombre del equipo, tal como lo escribió el docente |
| `source_type` | Texto: git o zip | Cómo se obtuvo el código |
| `source` | Texto | URL del repositorio o nombre original del ZIP |
| `dir` | Texto | Carpeta del proyecto en disco, devuelta por el núcleo |
| `created_at` | Texto | Fecha de registro en formato ISO |

```sql
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  team TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('git', 'zip')),
  source TEXT NOT NULL,
  dir TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
```

### Cómo usar `node:sqlite`

- Se abre con `new DatabaseSync('data/app.db')`, se crean las tablas con `exec` y las consultas se preparan con `prepare`, que luego se ejecutan con `run`, `get` o `all`.
- Si se pasa un parámetro con nombre que la consulta no usa, lanza un error.
- No trae un envoltorio para transacciones: se hacen con `exec('BEGIN')` y `exec('COMMIT')`.
- La búsqueda es `WHERE name LIKE ? OR team LIKE ?` con el texto entre `%`.
- El domingo, antes de construir sobre él, hay que correr un ejemplo mínimo en la laptop. Si imprime advertencias o falla, se cambia a `better-sqlite3`, que tiene una forma muy parecida.

## Rutas de la API en detalle

Todas las rutas cuelgan de `/api` y responden JSON. Un proyecto siempre se devuelve con esta forma, mezclando lo guardado en SQLite con lo que dice el núcleo Docker:

```json
{
  "id": 1,
  "name": "tienda-equipo-3",
  "team": "Equipo 3",
  "state": "running",
  "ports": [8080],
  "url": "http://localhost:8080"
}
```

`state` es `running` o `stopped` (la interfaz los muestra como **Encendido** y **Apagado**). `url` se arma con el primer puerto y es `null` si no hay puertos. Los errores usan siempre `{ "message": "texto legible en español" }`.

| Ruta | Entrada | Respuesta correcta | Errores |
|---|---|---|---|
| `GET /api/projects` | `q` opcional, texto a buscar en nombre y equipo | 200 y una lista de proyectos | Ninguno esperado |
| `POST /api/projects` | JSON con `team`, `name` y `repoUrl`; o formulario con `team`, `name` y el archivo `file` (ZIP) | 201 y el proyecto creado | 400 si falta un dato o la URL no es válida; 409 si el nombre ya existe; 500 si el núcleo falla al preparar el proyecto |
| `GET /api/projects/:id` | Ninguna | 200 y el proyecto | 404 si no existe |
| `POST /api/projects/:id/start` | Ninguna | 200 y el proyecto con su estado nuevo | 404 si no existe; 500 si el núcleo falla |
| `POST /api/projects/:id/stop` | Ninguna | 200 y el proyecto con su estado nuevo | 404 si no existe; 500 si el núcleo falla |

### Registro de un proyecto, paso a paso

1. Validar la entrada con un esquema de TypeBox.
2. Calcular el nombre con `normalizeProjectName` y, si ya existe un proyecto con ese nombre, responder 409 antes de gastar tiempo en clonar o descomprimir.
3. Si viene un ZIP, guardarlo en un archivo temporal y borrarlo al terminar el registro, haya salido bien o mal.
4. Llamar a `prepareProject` del núcleo con la fuente y el nombre.
5. Guardar la fila en SQLite con el nombre normalizado y la carpeta que devolvió el núcleo.
6. Responder 201 con el proyecto, consultando su estado con `getProjectStatus`.

### Subida de ZIP con `@fastify/multipart`

- Con `req.parts()` se recorren los campos de texto y el archivo en la misma petición.
- El archivo se guarda en disco con `pipeline(part.file, fs.createWriteStream(ruta))`, sin cargarlo en memoria.
- El límite de tamaño se define con `limits.fileSize`. Si se alcanza, el archivo queda truncado (`part.file.truncated`): hay que borrar lo guardado y responder 400.

**Encender puede tardar minutos.** La primera vez, Docker descarga las imágenes del proyecto. La ruta debe esperar a que el núcleo termine y responder después. Hay que revisar que el servidor no corte la petición por tiempo de espera y que la interfaz muestre que está trabajando.

**TypeBox en Fastify.** El proveedor de tipos no se hereda entre plugins: hay que volver a llamar a `withTypeProvider<TypeBoxTypeProvider>()` dentro de cada plugin de rutas.

## Conexión con el núcleo Docker (Área 1)

Estas son las firmas que 0V3R implementa en `core/`. Isaac las usa tal cual y no cambian sin acuerdo entre los dos. Cambió una respecto al documento de visión: `prepareProject` recibe también el nombre, y se suma `normalizeProjectName`.

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

- `prepareProject` clona o descomprime en `projects/`, normaliza el nombre y devuelve la carpeta y el nombre final.
- Si algo falla, las funciones lanzan un `Error` con un mensaje legible. La API lo devuelve con código 500 y ese mensaje.

### Versión simulada mientras tanto

En `api/src/core-stub.ts` Isaac escribe las cuatro funciones con datos falsos:

- `prepareProject` usa `normalizeProjectName` (minúsculas, sin tildes; solo letras, dígitos, guiones y guiones bajos) y devuelve `projects/<nombre>` sin crear nada.
- `startProject` y `stopProject` cambian el estado de un mapa en memoria y devuelven un puerto inventado al encender.
- `getProjectStatus` lee ese mapa.

La API importa el núcleo desde un solo archivo, `api/src/core.ts`, que reexporta el simulado o el real. Cambiar de uno a otro es modificar esa línea, y no debe tocar nada más.

## Interfaz web

La interfaz es una sola página, sin login: un listado de proyectos con búsqueda y un formulario para registrar. La usa el docente, así que debe ser clara; no necesita ser vistosa.

### Listado

- Tabla con las columnas **Nombre, Equipo, Estado, Puertos y Acciones**.
- El estado se muestra como una insignia: **Encendido** o **Apagado**.
- En Acciones aparece **Encender** si el proyecto está apagado y **Apagar** si está encendido. Si está encendido, aparece también **Abrir**, que abre `url` en una pestaña nueva.
- Sobre la tabla hay un campo de búsqueda. Al escribir, consulta a la API con `q`, esperando unos 300 milisegundos desde la última tecla.

### Formulario de registro

- Campos: **Equipo, Nombre del proyecto y Origen**, que se elige entre **Repositorio de GitHub** y **Archivo ZIP**.
- Si el origen es un repositorio, se pide la URL; si es un ZIP, se pide el archivo.
- Al enviar, el botón queda desactivado con el texto **Registrando**. Si la API responde con un error, se muestra su `message`; si todo sale bien, el proyecto aparece en el listado.

### Estados que hay que cubrir

- Cargando el listado.
- Listado vacío, con el mensaje: **Todavía no hay proyectos registrados.**
- No se puede conectar con la API.
- Acción en curso: el botón dice **Encendiendo** o **Apagando**, queda desactivado y no permite un segundo clic. Puede durar minutos la primera vez.
- Error en una acción, con el mensaje de la API visible junto al proyecto.

### Cómo se conecta con la API

- La interfaz pide los datos a rutas relativas (`/api/projects`). Así funciona igual en desarrollo y en producción.
- En desarrollo, el servidor de Astro reenvía `/api` a la API mediante la opción `vite` de `astro.config.mjs`, que acepta la configuración de Vite (`server.proxy`).
- En producción, Fastify sirve la carpeta compilada de `web/` con `@fastify/static`, con su ruta `root` absoluta. Así todo corre en un solo proceso y en un solo puerto.

### Estilos y herramientas

- Tailwind se instala con `npx astro add tailwind`, que agrega el plugin de Vite de Tailwind 4. Después basta con importar `tailwindcss` en el archivo de estilos global.
- Para no sumar dependencias en dos días, la recomendación es un `<script>` de TypeScript dentro de la página de Astro, sin otro framework. Isaac decide.

## Plan por día

El orden va de lo que no depende de nadie a lo que depende del núcleo real. Si algo se atrasa, se recorta de abajo hacia arriba dentro de cada día.

### Domingo

- [ ] Verificar la versión de Node en la laptop (24 o superior) y correr un ejemplo mínimo de `node:sqlite`.
- [ ] Crear `api/` con Fastify, TypeScript y TypeBox, y `web/` con Astro y Tailwind, si 0V3R aún no dejó la estructura.
- [ ] Crear la base de datos y la tabla `projects`.
- [ ] Escribir `core-stub.ts` con las cuatro funciones y `core.ts` que lo reexporta.
- [ ] Implementar las cinco rutas contra el núcleo simulado.
- [ ] Probarlas con `curl` y avisar a 0V3R cuando respondan.
- [ ] Interfaz: página con el listado y la búsqueda, usando datos reales de la API.

### Lunes por la mañana

- [ ] Interfaz: formulario de registro por repositorio y por ZIP.
- [ ] Interfaz: botones Encender y Apagar con sus estados, y el enlace Abrir.
- [ ] API: subida de ZIP con límite de tamaño y borrado del archivo parcial.
- [ ] Cambiar el núcleo simulado por el real de 0V3R.

### Lunes por la tarde

- [ ] Pruebas de punta a punta con los proyectos de prueba.
- [ ] Servir la interfaz compilada desde Fastify con `@fastify/static`.
- [ ] Corregir los fallos que aparezcan.
- [ ] Dejar notas breves del área: qué hace y cómo se prueba.

### Martes

- [ ] Apoyar la instalación en la PC del docente y la prueba final.

## Cómo probar y cuándo está terminado

Cada ruta se prueba desde la terminal antes de conectarle la interfaz. El puerto 3000 es un ejemplo: en producción la herramienta usa uno poco común (por ejemplo el 4300), para no chocar con los puertos de los proyectos.

```bash
curl http://localhost:3000/api/projects
curl "http://localhost:3000/api/projects?q=tienda"
curl -X POST http://localhost:3000/api/projects \
  -H 'Content-Type: application/json' \
  -d '{"team":"Equipo 3","name":"Tienda","repoUrl":"https://github.com/usuario/repo"}'
curl -F team='Equipo 3' -F name='Tienda' -F file=@proyecto.zip http://localhost:3000/api/projects
curl -X POST http://localhost:3000/api/projects/1/start
curl -X POST http://localhost:3000/api/projects/1/stop
```

El área está terminada cuando se cumple todo esto:

- [ ] Con la base vacía, el listado devuelve una lista vacía.
- [ ] Registrar por repositorio y por ZIP crea el proyecto y aparece en el listado.
- [ ] Registrar un nombre repetido responde 409, y con datos incompletos responde 400.
- [ ] Encender y apagar cambian el estado y los puertos que muestra el listado.
- [ ] La búsqueda filtra por nombre y por equipo.
- [ ] La interfaz hace todo lo anterior sin recargar la página.
- [ ] Si la API o el núcleo fallan, la interfaz muestra un mensaje legible y no una pantalla en blanco.
- [ ] Un solo comando arranca la API y sirve la interfaz compilada (se coordina con 0V3R).

## Límites del área y cuándo avisar

Isaac decide libremente cómo construye su parte dentro del contrato: la organización interna del código, el estilo de la interfaz y si usa o no un framework adicional.

### Si te encuentras haciendo esto, para y avisa a 0V3R

- Ejecutar `docker`, `docker compose` o `git`, o descomprimir un ZIP desde la API. Eso es del Área 1.
- Calcular puertos, decidir estados o normalizar nombres en la interfaz. Eso es de la API y del Área 1.
- Cambiar archivos de `core/`, `docs/` o `docker-compose.yml`. Son de 0V3R.
- Cambiar las rutas o las firmas del contrato sin avisar.

### Cuándo avisar a 0V3R

- Si necesitas una función o un dato del núcleo que no está en el contrato.
- Si el contrato te impide hacer algo razonable en la interfaz.
- Si algo de tu área no va a estar listo para la integración del lunes por la tarde. Hay que avisar con tiempo, no el lunes por la noche.
