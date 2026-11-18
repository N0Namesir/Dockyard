import { rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { assertNormalizedName } from './name.ts'
import { findComposeFile, projectRepoDir, projectsDir } from './paths.ts'
import { createProgressTracker } from './progress.ts'
import { CommandError, run, type RunOptions } from './run.ts'
import { PortConflictError, type PreparedProject, type ProjectStatus, type StartOptions } from './types.ts'

const START_TIMEOUT = 10 * 60_000
const STOP_TIMEOUT = 2 * 60_000
const STATUS_TIMEOUT = 30_000
const LOG_LINES = 200
/** Pausa tras `up -d` para que un contenedor que arranca y se cae alcance a figurar como detenido. */
const SETTLE_MS = 2_000
const SETTLE_CHECKS = 3
const SETTLE_CHECK_GAP_MS = 500

/** Ejecuta un comando de docker y traduce las fallas de conexión a un mensaje claro para el docente. */
export async function docker(args: string[], opts: RunOptions = {}): Promise<string> {
  try {
    return await run('docker', args, opts)
  } catch (err) {
    if (err instanceof CommandError) {
      if (/Cannot connect to the Docker daemon|Is the docker daemon running|docker\.sock: connect: no such file/i.test(err.stderr)) {
        throw new Error('Docker no responde. Verifica que el servicio de Docker esté encendido (sudo systemctl start docker) e intenta de nuevo.')
      }
      if (/permission denied.*docker/i.test(err.stderr)) {
        throw new Error('No hay permiso para usar Docker. Agrega el usuario al grupo docker (sudo usermod -aG docker $USER) y vuelve a iniciar sesión.')
      }
    }
    throw err
  }
}

/** Prefijo común de los comandos de compose: fija el nombre, la carpeta de trabajo y el archivo. */
async function composePrefix(dir: string, name: string): Promise<string[]> {
  assertNormalizedName(name)
  const location = await findComposeFile(dir)
  if (!location) {
    throw new Error(`No se encontró un archivo compose en ${dir}.`)
  }
  return ['compose', '-p', name, '--project-directory', location.dir, '-f', location.file]
}

/** Interpreta la salida de `ps --format json`: un objeto por línea o, en versiones antiguas, un arreglo. */
export function parsePs(out: string): any[] {
  const text = out.trim()
  if (!text) return []
  if (text.startsWith('[')) return JSON.parse(text)
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line))
}

/** Calcula el estado de un proyecto a partir de sus contenedores. */
export function statusFromContainers(containers: any[]): ProjectStatus {
  // Un contenedor que se reinicia sigue activo: debe poder apagarse.
  const active = containers.filter((c) => c.State === 'running' || c.State === 'restarting')
  const running = containers.filter((c) => c.State === 'running')
  const ports = new Set<number>()
  for (const c of running) {
    for (const p of c.Publishers ?? []) {
      if (p.PublishedPort > 0) ports.add(p.PublishedPort)
    }
  }
  const status: ProjectStatus = {
    state: active.length > 0 ? 'running' : 'stopped',
    ports: [...ports].sort((a, b) => a - b),
  }
  // Salir con 0 es normal (una migración que termina); apagado por completo no es una falla.
  const failed = containers.filter(
    (c) => c.State === 'restarting' || c.State === 'dead' || (c.State === 'exited' && (c.ExitCode ?? 0) !== 0),
  )
  if (active.length > 0 && failed.length > 0) {
    status.failedServices = [...new Set<string>(failed.map((c) => c.Service))].sort()
  }
  return status
}

async function listContainers(name: string): Promise<any[]> {
  assertNormalizedName(name)
  // Solo con -p: no depende de la carpeta ni del archivo compose. Con -a incluye los que se cayeron.
  return parsePs(await docker(['compose', '-p', name, 'ps', '-a', '--format', 'json'], { timeoutMs: STATUS_TIMEOUT }))
}

export async function getProjectStatus(name: string): Promise<ProjectStatus> {
  return statusFromContainers(await listContainers(name))
}

/**
 * Lleva una fila de `docker ps --format json` a la forma de `docker compose ps`, que es la que
 * entiende statusFromContainers: el servicio sale de su etiqueta, los puertos del texto Ports y el
 * código de salida del texto Status ("Exited (1) 3 minutes ago").
 */
export function composeRowOf(container: any): any {
  const exit = /^(?:Exited|Restarting) \((-?\d+)\)/.exec(String(container.Status ?? ''))
  const publishers = portsInUse([container]).map((p) => ({ PublishedPort: p.port, Protocol: p.protocol }))
  return {
    Service: composeServiceOf(container) ?? containerName(container),
    State: container.State,
    ExitCode: exit ? Number(exit[1]) : 0,
    Publishers: publishers,
  }
}

/** Agrupa las filas de `docker ps -a` por proyecto de compose y calcula el estado de cada uno. */
export function statusesFromContainers(containers: any[]): Record<string, ProjectStatus> {
  const byProject = new Map<string, any[]>()
  for (const container of containers) {
    const project = composeProjectOf(container)
    // `compose run` crea contenedores de un solo uso que `compose ps` tampoco muestra.
    if (!project || /(?:^|,)com\.docker\.compose\.oneoff=True(?:,|$)/.test(container.Labels ?? '')) continue
    const rows = byProject.get(project) ?? []
    rows.push(composeRowOf(container))
    byProject.set(project, rows)
  }
  const statuses: Record<string, ProjectStatus> = {}
  for (const [project, rows] of byProject) statuses[project] = statusFromContainers(rows)
  return statuses
}

/**
 * Estado de todos los proyectos de compose de la PC con una sola consulta a Docker, para que la
 * lista no lance un proceso por proyecto. Un proyecto sin contenedores no aparece: está apagado.
 */
export async function getProjectStatuses(): Promise<Record<string, ProjectStatus>> {
  const out = await docker(
    ['ps', '-a', '--filter', 'label=com.docker.compose.project', '--format', 'json'],
    { timeoutMs: STATUS_TIMEOUT },
  )
  return statusesFromContainers(parsePs(out))
}

/** Lanza un error si ya hay contenedores, encendidos o no, con este nombre de proyecto de compose. */
export async function assertProjectNameFree(name: string): Promise<void> {
  assertNormalizedName(name)
  const out = await docker(
    ['ps', '-a', '--filter', `label=com.docker.compose.project=${name}`, '--format', 'json'],
    { timeoutMs: STATUS_TIMEOUT },
  )
  const taken = parsePs(out)[0]
  if (taken) {
    throw new Error(`El nombre ${name} ya lo usa otro proyecto de Docker en esta PC (contenedor ${containerName(taken)}). Usa otro nombre.`)
  }
}

function containerName(container: any): string {
  return String(container.Names ?? '').split(',')[0] ?? ''
}

/** Nombres fijos (container_name) que un compose pide, a partir de `config --format json`. */
export function requestedContainerNames(config: any): string[] {
  return Object.values<any>(config?.services ?? {})
    .map((service) => service?.container_name)
    .filter((name): name is string => typeof name === 'string' && name !== '')
}

export function composeProjectOf(container: any): string | null {
  return /(?:^|,)com\.docker\.compose\.project=([^,]+)/.exec(container.Labels ?? '')?.[1] ?? null
}

export function composeServiceOf(container: any): string | null {
  return /(?:^|,)com\.docker\.compose\.service=([^,]+)/.exec(container.Labels ?? '')?.[1] ?? null
}

/** Lanza un error si un container_name del proyecto ya lo tiene un contenedor de otro proyecto. */
async function checkContainerNameConflicts(config: any, name: string): Promise<void> {
  const requested = requestedContainerNames(config)
  if (requested.length === 0) return

  // Con -a: un proyecto apagado con stop conserva sus contenedores y sus nombres.
  const containers = parsePs(await docker(['ps', '-a', '--format', 'json'], { timeoutMs: STATUS_TIMEOUT }))
    .filter((c) => composeProjectOf(c) !== name)

  for (const wanted of requested) {
    const taken = containers.find((c) => containerName(c) === wanted)
    if (taken) {
      const project = composeProjectOf(taken)
      const owner = project ? `el proyecto ${project}` : 'otro contenedor de esta PC'
      throw new Error(`El nombre de contenedor ${wanted} ya lo usa ${owner}, aunque esté apagado. Pide al equipo que quite container_name de su compose.`)
    }
  }
}

export interface PortRequest {
  port: number
  protocol: string
  service: string
}

/**
 * Puertos fijos que un compose pide publicar, a partir de `config --format json`.
 * Se omiten los puertos sin publicar (solo "80") y los rangos ("8000-8010"): Docker los resuelve.
 */
export function requestedPorts(config: any): PortRequest[] {
  const result: PortRequest[] = []
  for (const [service, def] of Object.entries<any>(config?.services ?? {})) {
    for (const p of def?.ports ?? []) {
      const published = String(p?.published ?? '')
      if (!/^\d+$/.test(published)) continue
      result.push({ port: Number(published), protocol: p.protocol ?? 'tcp', service })
    }
  }
  return result
}

export interface PortInUse {
  port: number
  protocol: string
  container: string
  project: string | null
}

/** Puertos que ya publican los contenedores en ejecución, a partir de `docker ps --format json`. */
export function portsInUse(containers: any[]): PortInUse[] {
  const result: PortInUse[] = []
  for (const c of containers) {
    const project = composeProjectOf(c)
    const container = containerName(c)
    // Ports es un texto como "0.0.0.0:8080->80/tcp, [::]:8080->80/tcp" o "0.0.0.0:8000-8002->8000-8002/tcp".
    for (const m of String(c.Ports ?? '').matchAll(/:(\d+)(?:-(\d+))?->[\d-]+\/(\w+)/g)) {
      const from = Number(m[1])
      const to = m[2] ? Number(m[2]) : from
      for (let port = from; port <= to; port++) {
        result.push({ port, protocol: m[3]!, container, project })
      }
    }
  }
  return result
}

/** Lanza un error si un puerto fijo o un container_name del proyecto ya lo tiene otro proyecto. */
async function checkConflicts(prefix: string[], name: string): Promise<void> {
  let config: any
  try {
    config = JSON.parse(await docker([...prefix, 'config', '--format', 'json'], { timeoutMs: STATUS_TIMEOUT }))
  } catch (err) {
    if (err instanceof CommandError) {
      throw new Error(`El archivo compose del proyecto tiene errores. Docker respondió:\n${lastLines(err.stderr, 5)}`)
    }
    throw err
  }
  await checkContainerNameConflicts(config, name)

  const requested = requestedPorts(config)
  if (requested.length === 0) return

  const used = portsInUse(parsePs(await docker(['ps', '--format', 'json'], { timeoutMs: STATUS_TIMEOUT })))
    .filter((u) => u.project !== name) // encender de nuevo un proyecto no choca consigo mismo

  for (const r of requested) {
    const taken = used.find((u) => u.port === r.port && u.protocol === r.protocol)
    if (taken) {
      throw new PortConflictError(r.port, taken.container, taken.project)
    }
  }
}

/**
 * Un contenedor con restart: always que falla aparece running por instantes entre reinicios.
 * Por eso una sola mirada no basta: encendido es seguir running en todas.
 */
async function settledContainers(name: string): Promise<any[]> {
  let containers = await listContainers(name)
  for (let i = 1; i < SETTLE_CHECKS && containers.some((c) => c.State === 'running'); i++) {
    await sleep(SETTLE_CHECK_GAP_MS)
    containers = await listContainers(name)
  }
  return containers
}

export async function startProject(
  dir: string,
  name: string,
  options: StartOptions = {},
): Promise<ProjectStatus> {
  const progress = createProgressTracker(options.onProgress)
  const prefix = await composePrefix(dir, name)
  progress.setStage('Revisando puertos y nombres')
  await checkConflicts(prefix, name)
  progress.setStage('Pidiendo a Docker que encienda el proyecto')

  try {
    await docker([...prefix, 'up', '-d', ...(options.build ? ['--build'] : [])], { timeoutMs: START_TIMEOUT, onLine: progress.addLine })
  } catch (err) {
    if (err instanceof CommandError) {
      if (err.timedOut) {
        throw new Error('El proyecto tardó más de 10 minutos en encender y se canceló. Revisa su compose o intenta de nuevo: la primera vez Docker descarga y construye imágenes.')
      }
      throw new Error(`No se pudo encender el proyecto. Docker respondió:\n${lastLines(err.stderr, 10)}`)
    }
    throw err
  }

  progress.setStage('Comprobando que sigan encendidos')
  await sleep(SETTLE_MS)
  const containers = await settledContainers(name)
  if (!containers.some((c) => c.State === 'running')) {
    const logs = await docker([...prefix, 'logs', '--tail', '20', '--no-color'], { timeoutMs: STATUS_TIMEOUT }).catch(() => '')
    // Con restart: always seguiría reiniciándose sin fin; se detiene para que quede de verdad apagado.
    await docker([...prefix, 'stop'], { timeoutMs: STOP_TIMEOUT }).catch(() => {})
    throw new Error(`El proyecto se encendió, pero sus contenedores se detuvieron enseguida. Últimas líneas del registro:\n${logs.trim() || '(sin registro)'}`)
  }
  return statusFromContainers(containers)
}

export async function stopProject(dir: string, name: string): Promise<ProjectStatus> {
  const prefix = await composePrefix(dir, name)
  try {
    // stop y no down: no borra contenedores ni redes, así encender de nuevo es rápido.
    await docker([...prefix, 'stop'], { timeoutMs: STOP_TIMEOUT })
  } catch (err) {
    if (err instanceof CommandError) {
      throw new Error(`No se pudo apagar el proyecto. Docker respondió:\n${lastLines(err.stderr, 10)}`)
    }
    throw err
  }
  return getProjectStatus(name)
}

/** Últimas líneas del registro de todos los servicios, incluidos los que ya se detuvieron. */
export async function getProjectLogs(name: string): Promise<string> {
  assertNormalizedName(name)
  try {
    return await docker(['compose', '-p', name, 'logs', '--tail', String(LOG_LINES), '--no-color'], { timeoutMs: STATUS_TIMEOUT })
  } catch (err) {
    if (err instanceof CommandError) {
      throw new Error(`No se pudo leer el registro del proyecto. Docker respondió:\n${lastLines(err.stderr, 5)}`)
    }
    throw err
  }
}

/**
 * Borra los contenedores, las redes, los volúmenes y la carpeta del proyecto. Se puede repetir
 * sin problema: lo que ya no existe se ignora.
 */
export async function removeProject(name: string): Promise<void> {
  assertNormalizedName(name)
  const target = join(projectsDir(), name)
  try {
    await removeContainers(target, name)
  } catch (err) {
    if (err instanceof CommandError) {
      throw new Error(`No se pudieron borrar los contenedores del proyecto. Docker respondió:\n${lastLines(err.stderr, 10)}`)
    }
    throw err
  }

  try {
    await rm(target, { recursive: true, force: true })
    await rm(projectRepoDir(name), { recursive: true, force: true })
    // Restos de un reemplazo de ZIP: si tienen archivos de root, ya se avisó al reemplazar.
    await rm(join(projectsDir(), '.reemplazos', name), { recursive: true, force: true }).catch(() => {})
  } catch (err: any) {
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      // Los contenedores del proyecto pueden haber creado archivos de root en sus carpetas montadas.
      throw new Error(`Los contenedores se borraron, pero el proyecto dejó archivos sin permiso de borrado. Ejecuta en una terminal: sudo rm -rf ${target} y vuelve a eliminarlo.`)
    }
    throw err
  }
}

/**
 * Borra los contenedores, la red y los volúmenes del proyecto, y conserva su carpeta y sus imágenes:
 * el siguiente encendido crea la base de nuevo, vuelve a cargar su `.sql` y no reconstruye. Las
 * carpetas montadas desde el proyecto (`./data:/var/lib/mysql`) no se tocan: son código del equipo.
 */
export async function resetProjectData(dir: string, name: string): Promise<void> {
  const prefix = await composePrefix(dir, name)
  try {
    await docker([...prefix, 'down', '-v', '--remove-orphans'], { timeoutMs: STOP_TIMEOUT })
  } catch (err) {
    if (err instanceof CommandError) {
      throw new Error(`No se pudieron borrar los datos del proyecto. Docker respondió:\n${lastLines(err.stderr, 10)}`)
    }
    throw err
  }
}

/**
 * Cambia el nombre de un proyecto apagado: su nombre de compose, su carpeta y la de su repositorio.
 * Los volúmenes de Docker no se pueden renombrar, así que se niega si el proyecto tiene alguno:
 * con otro nombre empezaría sin sus datos. Borra los contenedores, la red y las imágenes del nombre
 * anterior; el siguiente encendido los crea de nuevo. Devuelve la carpeta del compose.
 */
export async function renameProject(name: string, newName: string): Promise<PreparedProject> {
  assertNormalizedName(name)
  assertNormalizedName(newName)
  const from = join(projectsDir(), name)
  const to = join(projectsDir(), newName)
  if (!await isDirectory(from)) throw new Error(`No se encontró la carpeta del proyecto en ${from}. Elimínalo y regístralo de nuevo.`)
  if (name !== newName) {
    if ((await getProjectStatus(name)).state === 'running') {
      throw new Error('Apaga el proyecto antes de cambiarle el nombre.')
    }
    await assertProjectNameFree(newName)
    for (const dir of [to, projectRepoDir(newName)]) {
      if (await exists(dir)) throw new Error(`Ya existe la carpeta ${dir}. Usa otro nombre o, si ese proyecto ya no se usa, borra la carpeta.`)
    }
    const volumes = (await docker(
      ['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${name}`],
      { timeoutMs: STATUS_TIMEOUT },
    )).split('\n').filter(Boolean)
    if (volumes.length > 0) {
      throw new Error(`No se puede cambiar el nombre porque el proyecto guarda datos en volúmenes de Docker (${volumes.join(', ')}): con otro nombre empezaría sin ellos. Si esos datos no hacen falta, elimínalo y regístralo de nuevo con el nombre correcto.`)
    }
    try {
      await removeContainers(from, name, { volumes: false })
    } catch (err) {
      if (err instanceof CommandError) {
        throw new Error(`No se pudieron borrar los contenedores del nombre anterior. Docker respondió:\n${lastLines(err.stderr, 10)}`)
      }
      throw err
    }
    // Renombrar no depende de los permisos de lo que hay dentro: no falla a medias por archivos de root.
    await rename(from, to)
    if (await exists(projectRepoDir(name))) {
      try {
        await rename(projectRepoDir(name), projectRepoDir(newName))
      } catch (err) {
        await rename(to, from)
        throw err
      }
    }
    await rm(join(projectsDir(), '.reemplazos', name), { recursive: true, force: true }).catch(() => {})
  }
  const location = await findComposeFile(to)
  if (!location) throw new Error(`No se encontró un archivo compose en ${to}.`)
  return { dir: location.dir, name: newName }
}

function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false)
}

function isDirectory(path: string): Promise<boolean> {
  return stat(path).then((info) => info.isDirectory(), () => false)
}

async function removeContainers(target: string, name: string, { volumes = true } = {}): Promise<void> {
  const down = volumes ? ['down', '-v', '--remove-orphans'] : ['down', '--remove-orphans']
  const location = await findComposeFile(target).catch(() => null)
  if (location) {
    try {
      // Con el archivo también se borran las imágenes que el proyecto construyó.
      const prefix = ['compose', '-p', name, '--project-directory', location.dir, '-f', location.file]
      await docker([...prefix, ...down, '--rmi', 'local'], { timeoutMs: STOP_TIMEOUT })
      return
    } catch (err) {
      if (!(err instanceof CommandError)) throw err
      // El compose puede ya no ser válido: sin él, Docker encuentra los contenedores por el nombre.
    }
  }
  await docker(['compose', '-p', name, ...down], { timeoutMs: STOP_TIMEOUT })
}

function lastLines(text: string, n: number): string {
  return text.trim().split('\n').slice(-n).join('\n')
}
