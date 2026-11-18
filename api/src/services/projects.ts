import { randomUUID } from 'node:crypto'
import type { ProjectResources, ProjectSource, ProjectStatus, ResourceUsage, StartProgress } from '../core.ts'
import type { ProjectRepository } from '../db/projects.ts'
import { errorMessage, HttpError } from '../errors.ts'
import type {
  CoreAdapter,
  ProgressResponse,
  ProjectResponse,
  ProjectRow,
  RegistrationResponse,
  ReplaceResponse,
  ResourcesResponse,
  ResumeResult,
  StopAllResponse,
  UpdateResponse,
} from '../types.ts'
import type { CheckWeb, WebCheck } from './web-check.ts'

export interface RegisterProjectInput {
  team: string
  name: string
  source: ProjectSource
  sourceLabel: string
  /** true si quien pidió el registro ya no espera la respuesta: una falla queda en la lista. */
  abandoned?: () => boolean
}

interface Registration {
  key: string
  name: string
  team: string
  sourceType: ProjectSource['type']
  stage: string
  percent: number | null
  error: string | null
  startedAt: number
}

/** Puertos habituales de servicios que no son páginas: bases de datos, colas y cachés. */
const NON_WEB_PORTS = new Set([1433, 1521, 3306, 5432, 5672, 6379, 9042, 11211, 27017])

/**
 * Una web que contesta se vuelve a pedir cada minuto como mucho: la lista se refresca cada 15 s y
 * algunos proyectos limitan las peticiones por dirección IP.
 */
const WEB_CHECK_TTL_MS = 60_000

/** Una muestra de Docker tarda unos 2 s: varias pestañas abiertas comparten la misma. */
const RESOURCES_TTL_MS = 5_000

/** Apagar todos va de a pocos: cada stop lanza un proceso de docker compose. */
const STOP_ALL_CONCURRENCY = 4

/** Al arrancar se encienden de a dos: cada uno puede construir imágenes y eso carga la PC. */
const RESUME_CONCURRENCY = 2

/** El puerto de "Abrir": el primero que parezca una página; si ninguno, el primero. */
function mainPortOf(status: ProjectStatus): number | undefined {
  return status.ports.find((port) => !NON_WEB_PORTS.has(port)) ?? status.ports[0]
}

function toResponse(
  row: ProjectRow,
  status: ProjectStatus,
  web: WebCheck | null,
  progress: ProgressResponse | null,
): ProjectResponse {
  const mainPort = mainPortOf(status)
  return {
    id: row.id,
    name: row.name,
    team: row.team,
    sourceType: row.source_type,
    state: status.state,
    ports: status.ports,
    url: mainPort === undefined ? null : `http://localhost:${mainPort}`,
    urls: status.ports.map((port) => `http://localhost:${port}`),
    failedServices: status.failedServices ?? [],
    web,
    warnings: JSON.parse(row.warnings) as string[],
    progress,
    pendingBuild: row.needs_build === 1,
    notes: row.notes,
  }
}

export function createProjectService(
  repository: ProjectRepository,
  core: CoreAdapter,
  checkWeb: CheckWeb,
) {
  // Operaciones en curso: una petición repetida espera el mismo resultado en vez de lanzar otra.
  const inFlight = new Map<string, Promise<unknown>>()

  function once<T>(
    id: number,
    action: 'start' | 'stop' | 'remove' | 'update' | 'replace' | 'rename',
    run: () => Promise<T>,
  ): Promise<T> {
    const key = `${id}:${action}`
    const current = inFlight.get(key)
    if (current) return current as Promise<T>
    const operation = run().finally(() => inFlight.delete(key))
    inFlight.set(key, operation)
    return operation
  }

  // Solo en memoria: el avance no sirve una vez terminado el encendido.
  const starts = new Map<number, { startedAt: number; current: StartProgress }>()

  function progressOf(id: number): ProgressResponse | null {
    const start = starts.get(id)
    if (!start) return null
    return { ...start.current, elapsedSeconds: Math.floor((Date.now() - start.startedAt) / 1000) }
  }

  // Registros en curso y los que fallaron sin nadie esperando, por clave. Solo en memoria.
  const registrations = new Map<string, Registration>()

  function registrationResponse(registration: Registration): RegistrationResponse {
    const { startedAt, ...rest } = registration
    return { ...rest, elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000) }
  }

  let resourcesSample: { at: number; usage: Promise<ResourceUsage> } | null = null

  function sampleResources(): Promise<ResourceUsage> {
    if (resourcesSample && Date.now() - resourcesSample.at < RESOURCES_TTL_MS) return resourcesSample.usage
    const sample = { at: Date.now(), usage: core.getResources() }
    resourcesSample = sample
    // Una falla no se conserva: la siguiente petición vuelve a intentarlo.
    sample.usage.catch(() => {
      if (resourcesSample === sample) resourcesSample = null
    })
    return sample.usage
  }

  const webChecks = new Map<number, { port: number; at: number; result: WebCheck }>()

  async function webCheckOf(row: ProjectRow, status: ProjectStatus): Promise<WebCheck | null> {
    const port = mainPortOf(status)
    if (status.state !== 'running' || port === undefined || NON_WEB_PORTS.has(port)) {
      webChecks.delete(row.id)
      return null
    }
    const saved = webChecks.get(row.id)
    // Lo que no contesta se repite siempre, para notar pronto que ya arrancó.
    if (saved && saved.port === port && saved.result.state !== 'no-response'
      && Date.now() - saved.at < WEB_CHECK_TTL_MS) {
      return saved.result
    }
    const result = await checkWeb(port)
    webChecks.set(row.id, { port, at: Date.now(), result })
    return result
  }

  async function respond(row: ProjectRow, status: ProjectStatus): Promise<ProjectResponse> {
    const web = await webCheckOf(row, status)
    return toResponse(row, status, web, progressOf(row.id))
  }

  async function hydrate(row: ProjectRow): Promise<ProjectResponse> {
    return respond(row, await core.getProjectStatus(row.name))
  }

  const STOPPED: ProjectStatus = { state: 'stopped', ports: [] }

  function stopRow(row: ProjectRow): Promise<ProjectResponse> {
    return once(row.id, 'stop', async () => {
      const status = await core.stopProject(row.dir, row.name)
      repository.setKeepRunning(row.id, false)
      return respond(row, status)
    })
  }

  async function start(id: number): Promise<ProjectResponse> {
    const project = requireProject(id)
    if (['update', 'replace', 'rename'].some((action) => inFlight.has(`${id}:${action}`))) {
      throw new HttpError(409, 'El proyecto se está actualizando o cambiando de nombre. Espera a que termine.')
    }
    return once(id, 'start', async () => {
      const start = { startedAt: Date.now(), current: { stage: '', lines: [] } as StartProgress }
      starts.set(id, start)
      let status: ProjectStatus
      try {
        status = await core.startProject(project.dir, project.name, {
          build: project.needs_build === 1,
          onProgress: (progress) => {
            start.current = progress
          },
        })
        repository.clearNeedsBuild(id)
        repository.setKeepRunning(id, true)
      } catch (error) {
        throw portConflictOf(error, id) ?? error
      } finally {
        starts.delete(id)
      }
      webChecks.delete(id)
      return respond(requireProject(id), status)
    })
  }

  // Una sola tanda a la vez: una petición repetida espera el resultado de la que ya corre.
  let stoppingAll: Promise<StopAllResponse> | null = null

  async function runStopAll(): Promise<StopAllResponse> {
    const statuses = await core.getProjectStatuses()
    const running = repository.list().filter((row) => statuses[row.name]?.state === 'running')
    const result: StopAllResponse = { stopped: [], skipped: [], failed: [] }
    const queue = [...running]
    async function worker(): Promise<void> {
      for (let row = queue.shift(); row; row = queue.shift()) {
        if (['start', 'update', 'replace', 'remove', 'rename'].some((action) => inFlight.has(`${row!.id}:${action}`))) {
          result.skipped.push(row.name)
          continue
        }
        try {
          await stopRow(row)
          result.stopped.push(row.name)
        } catch (error) {
          result.failed.push({ name: row.name, message: errorMessage(error) })
        }
      }
    }
    await Promise.all(Array.from({ length: STOP_ALL_CONCURRENCY }, worker))
    // El orden de la lista, no el de llegada: así el mensaje no cambia de una vez a otra.
    const order = new Map(running.map((row, index) => [row.name, index]))
    const byList = (a: string, b: string) => order.get(a)! - order.get(b)!
    result.stopped.sort(byList)
    result.skipped.sort(byList)
    result.failed.sort((a, b) => byList(a.name, b.name))
    return result
  }

  /**
   * Un choque de puertos con otro proyecto registrado se responde con ese proyecto, para que la
   * interfaz ofrezca apagarlo y encender este. Lo demás que corra en la PC no se ofrece apagar.
   */
  function portConflictOf(error: unknown, id: number): HttpError | null {
    if (!(error instanceof Error) || error.name !== 'PortConflictError') return null
    const { port, project } = error as Error & { port: number; project: string | null }
    const other = project ? repository.findByName(project) : undefined
    if (!other || other.id === id) return null
    return new HttpError(
      409,
      `El puerto ${port} ya lo usa el proyecto ${other.name}, que está encendido. Apágalo o pide al equipo que cambie el puerto en el compose.`,
      { conflict: { id: other.id, name: other.name, port } },
    )
  }

  function requireProject(id: number): ProjectRow {
    const project = repository.findById(id)
    if (!project) throw new HttpError(404, 'El proyecto solicitado no existe.')
    return project
  }

  return {
    /**
     * Lo que se cortaría si Dockyard se reiniciara ahora: encendidos, apagados, actualizaciones y
     * registros en curso. Los proyectos encendidos no cuentan: siguen encendidos.
     */
    busy(): boolean {
      return inFlight.size > 0 || [...registrations.values()].some((item) => item.error === null)
    },

    async list(query?: string): Promise<ProjectResponse[]> {
      const rows = repository.list(query)
      if (rows.length === 0) return []
      // Una sola consulta a Docker para toda la lista, no un proceso por proyecto.
      const statuses = await core.getProjectStatuses()
      return Promise.all(rows.map((row) => respond(row, statuses[row.name] ?? STOPPED)))
    },

    async get(id: number): Promise<ProjectResponse> {
      return hydrate(requireProject(id))
    },

    /**
     * Descarga o descomprime el proyecto, lo revisa y lo guarda. Mientras tanto figura en
     * registrations() con su etapa, para que la página lo muestre aunque se recargue.
     */
    async register(input: RegisterProjectInput): Promise<ProjectResponse> {
      const normalizedName = core.normalizeProjectName(input.name)
      if (repository.findByName(normalizedName)) {
        throw new HttpError(
          409,
          `Ya existe un proyecto con el nombre “${normalizedName}”. Usa otro nombre.`,
        )
      }
      for (const [key, other] of registrations) {
        if (other.name !== normalizedName) continue
        if (other.error === null) {
          throw new HttpError(409, `Ya se está registrando un proyecto con el nombre “${normalizedName}”. Espera a que termine.`)
        }
        // Volver a intentarlo reemplaza la falla anterior.
        registrations.delete(key)
      }

      const registration: Registration = {
        key: randomUUID(),
        name: normalizedName,
        team: input.team,
        sourceType: input.source.type,
        stage: 'Preparando',
        percent: null,
        error: null,
        startedAt: Date.now(),
      }
      registrations.set(registration.key, registration)
      let row: ProjectRow
      try {
        const prepared = await core.prepareProject(input.source, input.name, {
          onProgress: ({ stage, percent }) => {
            registration.stage = stage
            registration.percent = percent
          },
        })
        registration.stage = 'Revisando el proyecto'
        registration.percent = null
        const warnings = await core.reviewProject(prepared.dir, prepared.name)
        row = repository.insert({
          name: prepared.name,
          team: input.team,
          sourceType: input.source.type,
          source: input.sourceLabel,
          dir: prepared.dir,
          warnings,
        })
      } catch (error) {
        // Si la pestaña sigue abierta, ella muestra el error; si no, queda en la lista.
        if (input.abandoned?.()) {
          registration.error = errorMessage(error)
          registration.percent = null
        } else {
          registrations.delete(registration.key)
        }
        throw error
      }
      registrations.delete(registration.key)
      return hydrate(row)
    },

    /** Registros en curso y fallidos sin descartar, el más reciente primero. */
    registrations(): RegistrationResponse[] {
      return [...registrations.values()]
        .sort((a, b) => b.startedAt - a.startedAt)
        .map(registrationResponse)
    },

    /** Quita de la lista un registro que falló. Uno en curso no se puede quitar. */
    dismissRegistration(key: string): void {
      const registration = registrations.get(key)
      if (!registration) throw new HttpError(404, 'Ese registro ya no está en la lista.')
      if (registration.error === null) throw new HttpError(409, 'El registro sigue en curso. Espera a que termine.')
      registrations.delete(key)
    },

    /** Solo de los proyectos registrados: lo demás que corra en la PC no es asunto de Dockyard. */
    async resources(): Promise<ResourcesResponse> {
      const usage = await sampleResources()
      const projects: Record<number, ProjectResources> = {}
      const total = { cpuPercent: 0, memoryBytes: 0 }
      for (const row of repository.list()) {
        const resources = usage.projects[row.name]
        if (!resources) continue
        projects[row.id] = resources
        total.cpuPercent += resources.cpuPercent
        total.memoryBytes += resources.memoryBytes
      }
      return { memoryLimit: usage.memoryLimit, total, projects }
    },

    progress(id: number): { progress: ProgressResponse | null } {
      requireProject(id)
      return { progress: progressOf(id) }
    },

    async logs(id: number): Promise<{ logs: string }> {
      const project = requireProject(id)
      return { logs: await core.getProjectLogs(project.name) }
    },

    async remove(id: number): Promise<void> {
      const project = requireProject(id)
      if (['start', 'stop', 'update', 'replace', 'rename'].some((action) => inFlight.has(`${id}:${action}`))) {
        throw new HttpError(409, 'El proyecto se está encendiendo, apagando o actualizando. Espera a que termine.')
      }
      return once(id, 'remove', async () => {
        await core.removeProject(project.name)
        repository.delete(id)
        webChecks.delete(id)
      })
    },

    start,

    async update(id: number): Promise<UpdateResponse> {
      const project = requireProject(id)
      if (project.source_type !== 'git') {
        throw new HttpError(409, 'Solo se actualizan los proyectos registrados desde GitHub. Para un proyecto registrado desde un ZIP, usa Reemplazar ZIP.')
      }
      if (['start', 'stop', 'remove', 'rename'].some((action) => inFlight.has(`${id}:${action}`))) {
        throw new HttpError(409, 'El proyecto se está encendiendo, apagando o eliminando. Espera a que termine.')
      }
      return once(id, 'update', async () => {
        // Apagado, para que el docente vea los avisos de la versión nueva antes de que se ejecute.
        const status = await core.getProjectStatus(project.name)
        if (status.state === 'running') {
          throw new HttpError(409, 'Apaga el proyecto antes de actualizarlo.')
        }
        const { dir, changed, commit, summary } = await core.updateProject(project.name)
        if (changed) {
          const warnings = await core.reviewProject(dir, project.name)
          repository.applyUpdate(id, { dir, warnings })
        }
        return { project: await hydrate(requireProject(id)), changed, commit, summary }
      })
    },

    /** Cambia el código de un proyecto registrado desde un ZIP por el de un ZIP nuevo. */
    async replace(id: number, input: { filePath: string; sourceLabel: string }): Promise<ReplaceResponse> {
      const project = requireProject(id)
      if (project.source_type !== 'zip') {
        throw new HttpError(409, 'Solo se reemplaza el ZIP de los proyectos registrados desde un ZIP. Para uno de GitHub, usa Actualizar.')
      }
      if (['start', 'stop', 'remove', 'rename'].some((action) => inFlight.has(`${id}:${action}`))) {
        throw new HttpError(409, 'El proyecto se está encendiendo, apagando o eliminando. Espera a que termine.')
      }
      return once(id, 'replace', async () => {
        // Apagado, para que el docente vea los avisos del ZIP nuevo antes de que se ejecute.
        const status = await core.getProjectStatus(project.name)
        if (status.state === 'running') {
          throw new HttpError(409, 'Apaga el proyecto antes de reemplazar su ZIP.')
        }
        const { dir, leftover } = await core.replaceProjectZip(project.name, input.filePath)
        const warnings = await core.reviewProject(dir, project.name)
        repository.applyUpdate(id, { dir, warnings, source: input.sourceLabel })
        webChecks.delete(id)
        return { project: await hydrate(requireProject(id)), leftover }
      })
    },

    /**
     * Cambia el equipo, el nombre o las notas. El equipo y las notas son solo datos; el nombre también es el de compose y
     * el de la carpeta, así que lo cambia el núcleo, con el proyecto apagado.
     */
    async edit(id: number, input: { team?: string; name?: string; notes?: string }): Promise<ProjectResponse> {
      const project = requireProject(id)
      const newName = input.name === undefined ? project.name : core.normalizeProjectName(input.name)
      if (newName !== project.name) {
        if (['start', 'stop', 'update', 'replace', 'remove'].some((action) => inFlight.has(`${id}:${action}`))) {
          throw new HttpError(409, 'El proyecto se está encendiendo, apagando o actualizando. Espera a que termine.')
        }
        if (repository.findByName(newName)) {
          throw new HttpError(409, `Ya existe un proyecto con el nombre “${newName}”. Usa otro nombre.`)
        }
        await once(id, 'rename', async () => {
          const status = await core.getProjectStatus(project.name)
          if (status.state === 'running') {
            throw new HttpError(409, 'Apaga el proyecto antes de cambiarle el nombre.')
          }
          const { dir } = await core.renameProject(project.name, newName)
          repository.rename(id, { name: newName, dir })
          webChecks.delete(id)
        })
      }
      if (input.team !== undefined) repository.setTeam(id, input.team)
      if (input.notes !== undefined) repository.setNotes(id, input.notes)
      return hydrate(requireProject(id))
    },

    async stop(id: number): Promise<ProjectResponse> {
      return stopRow(requireProject(id))
    },

    /**
     * Al arrancar Dockyard: vuelve a encender los proyectos que el docente dejó encendidos y están
     * apagados, como tras reiniciar la PC o el servicio de Docker. Los que encuentra encendidos
     * quedan marcados, para que una base anterior a esta función empiece con lo que ya corre.
     */
    async resume(): Promise<ResumeResult> {
      const statuses = await core.getProjectStatuses()
      const queue: ProjectRow[] = []
      for (const row of repository.list().reverse()) {
        if (statuses[row.name]?.state === 'running') {
          if (row.keep_running !== 1) repository.setKeepRunning(row.id, true)
        } else if (row.keep_running === 1) {
          queue.push(row)
        }
      }
      const result: ResumeResult = { started: [], failed: [] }
      async function worker(): Promise<void> {
        for (let row = queue.shift(); row; row = queue.shift()) {
          try {
            await start(row.id)
            result.started.push(row.name)
          } catch (error) {
            // Sigue marcado: el docente lo ve apagado y al encenderlo ve la causa.
            result.failed.push({ name: row.name, message: errorMessage(error) })
          }
        }
      }
      await Promise.all(Array.from({ length: RESUME_CONCURRENCY }, worker))
      return result
    },

    /** Apaga todos los proyectos registrados que estén encendidos, sin borrar nada. */
    stopAll(): Promise<StopAllResponse> {
      stoppingAll ??= runStopAll().finally(() => {
        stoppingAll = null
      })
      return stoppingAll
    },
  }
}

export type ProjectService = ReturnType<typeof createProjectService>
