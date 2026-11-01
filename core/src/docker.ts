import { setTimeout as sleep } from 'node:timers/promises'
import { assertNormalizedName } from './name.ts'
import { findComposeFile } from './paths.ts'
import { CommandError, run, type RunOptions } from './run.ts'
import type { ProjectStatus } from './types.ts'

const START_TIMEOUT = 10 * 60_000
const STOP_TIMEOUT = 2 * 60_000
const STATUS_TIMEOUT = 30_000
/** Pausa tras `up -d` para que un contenedor que arranca y se cae alcance a figurar como detenido. */
const SETTLE_MS = 2_000

/** Ejecuta un comando de docker y traduce las fallas de conexión a un mensaje claro para el docente. */
async function docker(args: string[], opts: RunOptions = {}): Promise<string> {
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
  const running = containers.filter((c) => c.State === 'running')
  const ports = new Set<number>()
  for (const c of running) {
    for (const p of c.Publishers ?? []) {
      if (p.PublishedPort > 0) ports.add(p.PublishedPort)
    }
  }
  return {
    state: running.length > 0 ? 'running' : 'stopped',
    ports: [...ports].sort((a, b) => a - b),
  }
}

export async function getProjectStatus(name: string): Promise<ProjectStatus> {
  assertNormalizedName(name)
  // Solo con -p: no depende de la carpeta ni del archivo compose.
  const out = await docker(['compose', '-p', name, 'ps', '--format', 'json'], { timeoutMs: STATUS_TIMEOUT })
  return statusFromContainers(parsePs(out))
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
    const project = /(?:^|,)com\.docker\.compose\.project=([^,]+)/.exec(c.Labels ?? '')?.[1] ?? null
    const container = String(c.Names ?? '').split(',')[0] ?? ''
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

/** Lanza un error si algún puerto fijo del proyecto ya lo ocupa un contenedor de otro proyecto. */
async function checkPortConflicts(prefix: string[], name: string): Promise<void> {
  const config = JSON.parse(await docker([...prefix, 'config', '--format', 'json'], { timeoutMs: STATUS_TIMEOUT }))
  const requested = requestedPorts(config)
  if (requested.length === 0) return

  const used = portsInUse(parsePs(await docker(['ps', '--format', 'json'], { timeoutMs: STATUS_TIMEOUT })))
    .filter((u) => u.project !== name) // encender de nuevo un proyecto no choca consigo mismo

  for (const r of requested) {
    const taken = used.find((u) => u.port === r.port && u.protocol === r.protocol)
    if (taken) {
      throw new Error(`El puerto ${r.port} ya está en uso por el contenedor ${taken.container}. Apaga ese proyecto o cambia el puerto en el compose.`)
    }
  }
}

export async function startProject(dir: string, name: string): Promise<ProjectStatus> {
  const prefix = await composePrefix(dir, name)
  await checkPortConflicts(prefix, name)

  try {
    await docker([...prefix, 'up', '-d'], { timeoutMs: START_TIMEOUT })
  } catch (err) {
    if (err instanceof CommandError) {
      if (err.timedOut) {
        throw new Error('El proyecto tardó más de 10 minutos en encender y se canceló. Revisa su compose o intenta de nuevo: la primera vez Docker descarga y construye imágenes.')
      }
      throw new Error(`No se pudo encender el proyecto. Docker respondió:\n${lastLines(err.stderr, 10)}`)
    }
    throw err
  }

  await sleep(SETTLE_MS)
  const status = await getProjectStatus(name)
  if (status.state === 'stopped') {
    const logs = await docker([...prefix, 'logs', '--tail', '20', '--no-color'], { timeoutMs: STATUS_TIMEOUT }).catch(() => '')
    throw new Error(`El proyecto se encendió, pero sus contenedores se detuvieron enseguida. Últimas líneas del registro:\n${logs.trim() || '(sin registro)'}`)
  }
  return status
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

function lastLines(text: string, n: number): string {
  return text.trim().split('\n').slice(-n).join('\n')
}
