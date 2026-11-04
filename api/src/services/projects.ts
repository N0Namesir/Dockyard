import type { ProjectResources, ProjectSource, ProjectStatus, ResourceUsage, StartProgress } from '../core.ts'
import type { ProjectRepository } from '../db/projects.ts'
import { HttpError } from '../errors.ts'
import type {
  CoreAdapter,
  ProgressResponse,
  ProjectResponse,
  ProjectRow,
  ResourcesResponse,
  UpdateResponse,
} from '../types.ts'
import type { CheckWeb, WebCheck } from './web-check.ts'

export interface RegisterProjectInput {
  team: string
  name: string
  source: ProjectSource
  sourceLabel: string
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
    action: 'start' | 'stop' | 'remove' | 'update',
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

  function requireProject(id: number): ProjectRow {
    const project = repository.findById(id)
    if (!project) throw new HttpError(404, 'El proyecto solicitado no existe.')
    return project
  }

  return {
    async list(query?: string): Promise<ProjectResponse[]> {
      return Promise.all(repository.list(query).map(hydrate))
    },

    async get(id: number): Promise<ProjectResponse> {
      return hydrate(requireProject(id))
    },

    async register(input: RegisterProjectInput): Promise<ProjectResponse> {
      const normalizedName = core.normalizeProjectName(input.name)
      if (repository.findByName(normalizedName)) {
        throw new HttpError(
          409,
          `Ya existe un proyecto con el nombre “${normalizedName}”. Usa otro nombre.`,
        )
      }

      const prepared = await core.prepareProject(input.source, input.name)
      const warnings = await core.reviewProject(prepared.dir, prepared.name)
      const row = repository.insert({
        name: prepared.name,
        team: input.team,
        sourceType: input.source.type,
        source: input.sourceLabel,
        dir: prepared.dir,
        warnings,
      })
      return hydrate(row)
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
      if (inFlight.has(`${id}:start`) || inFlight.has(`${id}:stop`) || inFlight.has(`${id}:update`)) {
        throw new HttpError(409, 'El proyecto se está encendiendo, apagando o actualizando. Espera a que termine.')
      }
      return once(id, 'remove', async () => {
        await core.removeProject(project.name)
        repository.delete(id)
        webChecks.delete(id)
      })
    },

    async start(id: number): Promise<ProjectResponse> {
      const project = requireProject(id)
      if (inFlight.has(`${id}:update`)) {
        throw new HttpError(409, 'El proyecto se está actualizando. Espera a que termine.')
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
        } finally {
          starts.delete(id)
        }
        webChecks.delete(id)
        return respond(requireProject(id), status)
      })
    },

    async update(id: number): Promise<UpdateResponse> {
      const project = requireProject(id)
      if (project.source_type !== 'git') {
        throw new HttpError(409, 'Solo se actualizan los proyectos registrados desde GitHub. Si el equipo entregó un ZIP nuevo, elimina este proyecto y regístralo de nuevo.')
      }
      if (['start', 'stop', 'remove'].some((action) => inFlight.has(`${id}:${action}`))) {
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

    async stop(id: number): Promise<ProjectResponse> {
      const project = requireProject(id)
      return once(id, 'stop', async () =>
        respond(project, await core.stopProject(project.dir, project.name)),
      )
    },
  }
}

export type ProjectService = ReturnType<typeof createProjectService>
