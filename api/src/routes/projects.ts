import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { HttpError } from '../errors.ts'
import type { ProjectService } from '../services/projects.ts'

const listQuerySchema = Type.Object({
  q: Type.Optional(Type.String({ maxLength: 200 })),
})

const idParamsSchema = Type.Object({
  id: Type.String({ pattern: '^[1-9][0-9]*$' }),
})

const repositoryBodySchema = Type.Object(
  {
    team: Type.String({ minLength: 1, maxLength: 120 }),
    name: Type.String({ minLength: 1, maxLength: 120 }),
    repoUrl: Type.String({ minLength: 1, maxLength: 2048 }),
  },
  { additionalProperties: false },
)

type ListQuery = Static<typeof listQuerySchema>
type IdParams = Static<typeof idParamsSchema>
type RepositoryBody = Static<typeof repositoryBodySchema>

interface MultipartProject {
  team: string
  name: string
  filePath: string
  originalFilename: string
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, `Falta ${label}.`)
  }
  return value.trim()
}

function validateRepositoryUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new HttpError(400, 'La URL del repositorio no es válida.')
  }

  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') {
    throw new HttpError(
      400,
      'El repositorio debe ser público y usar una URL HTTPS de GitHub.',
    )
  }
  if (url.username || url.password) {
    // Se guardaría en texto plano en la base de datos.
    throw new HttpError(
      400,
      'La URL del repositorio no debe incluir usuario ni contraseña.',
    )
  }
  return url.toString()
}

async function readMultipartProject(
  request: FastifyRequest,
  temporaryDir: string,
): Promise<MultipartProject> {
  const fields = new Map<string, string>()
  let filePath: string | undefined
  let originalFilename: string | undefined

  for await (const part of request.parts()) {
    if (part.type === 'field') {
      if (typeof part.value === 'string') fields.set(part.fieldname, part.value)
      continue
    }

    if (part.fieldname !== 'file' || filePath) {
      part.file.resume()
      continue
    }

    originalFilename = part.filename
    if (!originalFilename.toLowerCase().endsWith('.zip')) {
      part.file.resume()
      throw new HttpError(400, 'El archivo debe tener extensión .zip.')
    }

    filePath = join(temporaryDir, 'proyecto.zip')
    await pipeline(part.file, createWriteStream(filePath, { flags: 'wx' }))
    if (part.file.truncated) {
      throw new HttpError(
        400,
        'El archivo ZIP supera el límite permitido de 200 MB.',
      )
    }
  }

  if (!filePath || !originalFilename) {
    throw new HttpError(400, 'Falta el archivo ZIP del proyecto.')
  }

  return {
    team: requiredText(fields.get('team'), 'el nombre del equipo'),
    name: requiredText(fields.get('name'), 'el nombre del proyecto'),
    filePath,
    originalFilename,
  }
}

export function projectRoutes(service: ProjectService): FastifyPluginAsync {
  return async function routes(fastify) {
    const app = fastify.withTypeProvider<TypeBoxTypeProvider>()

    app.get<{ Querystring: ListQuery }>(
      '/projects',
      { schema: { querystring: listQuerySchema } },
      async (request) => service.list(request.query.q),
    )

    app.get<{ Params: IdParams }>(
      '/projects/:id',
      { schema: { params: idParamsSchema } },
      async (request) => service.get(Number(request.params.id)),
    )

    app.post('/projects', async (request, reply) => {
      if (request.isMultipart()) {
        const temporaryDir = await mkdtemp(join(tmpdir(), 'dockyard-'))
        let project
        try {
          const input = await readMultipartProject(request, temporaryDir)
          project = await service.register({
            team: input.team,
            name: input.name,
            source: { type: 'zip', filePath: input.filePath },
            sourceLabel: input.originalFilename,
          })
        } finally {
          await rm(temporaryDir, { recursive: true, force: true })
        }
        return reply.code(201).send(project)
      }

      if (!Value.Check(repositoryBodySchema, request.body)) {
        throw new HttpError(
          400,
          'Debes indicar equipo, nombre del proyecto y URL del repositorio.',
        )
      }

      const body = request.body as RepositoryBody
      const team = requiredText(body.team, 'el nombre del equipo')
      const name = requiredText(body.name, 'el nombre del proyecto')
      const repoUrl = validateRepositoryUrl(body.repoUrl)
      const project = await service.register({
        team,
        name,
        source: { type: 'git', url: repoUrl },
        sourceLabel: repoUrl,
      })
      return reply.code(201).send(project)
    })

    app.get<{ Params: IdParams }>(
      '/projects/:id/logs',
      { schema: { params: idParamsSchema } },
      async (request) => service.logs(Number(request.params.id)),
    )

    app.get<{ Params: IdParams }>(
      '/projects/:id/progress',
      { schema: { params: idParamsSchema } },
      async (request) => service.progress(Number(request.params.id)),
    )

    app.delete<{ Params: IdParams }>(
      '/projects/:id',
      { schema: { params: idParamsSchema } },
      async (request, reply) => {
        await service.remove(Number(request.params.id))
        return reply.code(204).send()
      },
    )

    app.post<{ Params: IdParams }>(
      '/projects/:id/start',
      { schema: { params: idParamsSchema } },
      async (request) => service.start(Number(request.params.id)),
    )

    app.post<{ Params: IdParams }>(
      '/projects/:id/stop',
      { schema: { params: idParamsSchema } },
      async (request) => service.stop(Number(request.params.id)),
    )
  }
}
