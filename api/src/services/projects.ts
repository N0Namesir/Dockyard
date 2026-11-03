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

function toResponse(row: ProjectRow, status: ProjectStatus): ProjectResponse {
  const firstPort = status.ports[0]
  return {
    id: row.id,
    name: row.name,
    team: row.team,
    state: status.state,
    ports: status.ports,
    url: firstPort === undefined ? null : `http://localhost:${firstPort}`,
  }
}

export function createProjectService(
  repository: ProjectRepository,
  core: CoreAdapter,
) {
  // Operaciones en curso: una petición repetida espera el mismo resultado en vez de lanzar otra.
  const inFlight = new Map<string, Promise<ProjectResponse>>()

  function once(
    id: number,
    action: 'start' | 'stop',
    run: () => Promise<ProjectResponse>,
  ): Promise<ProjectResponse> {
    const key = `${id}:${action}`
    const current = inFlight.get(key)
    if (current) return current
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
