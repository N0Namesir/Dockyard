import type { ProjectSource, ProjectStatus } from '../core.ts'
import type { ProjectRepository } from '../db/projects.ts'
import { HttpError } from '../errors.ts'
import type {
  CoreAdapter,
  ProjectResponse,
  ProjectRow,
} from '../types.ts'

export interface RegisterProjectInput {
  team: string
  name: string
  source: ProjectSource
  sourceLabel: string
}

/** Puertos habituales de servicios que no son páginas: bases de datos, colas y cachés. */
const NON_WEB_PORTS = new Set([1433, 1521, 3306, 5432, 5672, 6379, 9042, 11211, 27017])

function toResponse(row: ProjectRow, status: ProjectStatus): ProjectResponse {
  // "Abrir" usa el primer puerto que parezca una página; "Puertos" enlaza todos.
  const mainPort = status.ports.find((port) => !NON_WEB_PORTS.has(port)) ?? status.ports[0]
  return {
    id: row.id,
    name: row.name,
    team: row.team,
    state: status.state,
    ports: status.ports,
    url: mainPort === undefined ? null : `http://localhost:${mainPort}`,
    urls: status.ports.map((port) => `http://localhost:${port}`),
    failedServices: status.failedServices ?? [],
  }
}

export function createProjectService(
  repository: ProjectRepository,
  core: CoreAdapter,
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

  async function hydrate(row: ProjectRow): Promise<ProjectResponse> {
    return toResponse(row, await core.getProjectStatus(row.name))
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
      const row = repository.insert({
        name: prepared.name,
        team: input.team,
        sourceType: input.source.type,
        source: input.sourceLabel,
        dir: prepared.dir,
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
      })
    },

    async start(id: number): Promise<ProjectResponse> {
      const project = requireProject(id)
      return once(id, 'start', async () =>
        toResponse(project, await core.startProject(project.dir, project.name)),
      )
    },

    async stop(id: number): Promise<ProjectResponse> {
      const project = requireProject(id)
      return once(id, 'stop', async () =>
        toResponse(project, await core.stopProject(project.dir, project.name)),
      )
    },
  }
}

export type ProjectService = ReturnType<typeof createProjectService>
