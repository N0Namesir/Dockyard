import type { ProjectSource, ProjectStatus } from '../core.ts'
import type { ProjectRepository } from '../db/projects.ts'
import { HttpError } from '../errors.ts'
import type {
  CoreAdapter,
  ProjectResponse,
  ProjectRow,
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

/** El puerto de "Abrir": el primero que parezca una página; si ninguno, el primero. */
function mainPortOf(status: ProjectStatus): number | undefined {
  return status.ports.find((port) => !NON_WEB_PORTS.has(port)) ?? status.ports[0]
}

function toResponse(row: ProjectRow, status: ProjectStatus, web: WebCheck | null): ProjectResponse {
  const mainPort = mainPortOf(status)
  return {
    id: row.id,
    name: row.name,
    team: row.team,
    state: status.state,
    ports: status.ports,
    url: mainPort === undefined ? null : `http://localhost:${mainPort}`,
    urls: status.ports.map((port) => `http://localhost:${port}`),
    failedServices: status.failedServices ?? [],
    web,
    warnings: JSON.parse(row.warnings) as string[],
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
    action: 'start' | 'stop' | 'remove',
    run: () => Promise<T>,
  ): Promise<T> {
    const key = `${id}:${action}`
    const current = inFlight.get(key)
    if (current) return current as Promise<T>
    const operation = run().finally(() => inFlight.delete(key))
    inFlight.set(key, operation)
    return operation
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
    return toResponse(row, status, await webCheckOf(row, status))
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

    async logs(id: number): Promise<{ logs: string }> {
      const project = requireProject(id)
      return { logs: await core.getProjectLogs(project.name) }
    },

    async remove(id: number): Promise<void> {
      const project = requireProject(id)
      if (inFlight.has(`${id}:start`) || inFlight.has(`${id}:stop`)) {
        throw new HttpError(409, 'El proyecto se está encendiendo o apagando. Espera a que termine.')
      }
      return once(id, 'remove', async () => {
        await core.removeProject(project.name)
        repository.delete(id)
        webChecks.delete(id)
      })
    },

    async start(id: number): Promise<ProjectResponse> {
      const project = requireProject(id)
      return once(id, 'start', async () => {
        const status = await core.startProject(project.dir, project.name)
        webChecks.delete(id)
        return respond(project, status)
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
