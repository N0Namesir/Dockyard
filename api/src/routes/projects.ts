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
import { IMAGE_MAX_BYTES } from '../services/images.ts'
import { DISPLAY_NAME_MAX_LENGTH, type ProjectService } from '../services/projects.ts'
import { CONTACTS_MAX, contactSchema, DESCRIPTION_MAX_LENGTH, displayNameSchema, INSTRUCTIONS_MAX_LENGTH, NOTES_MAX_LENGTH, YEAR, yearSchema } from './schemas.ts'

const listQuerySchema = Type.Object({
  q: Type.Optional(Type.String({ maxLength: 200 })),
  /** Carpeta: un año o «todos». */
  year: Type.Optional(Type.String({ pattern: '^(\\d{4}|todos)$' })),
})

const idParamsSchema = Type.Object({
  id: Type.String({ pattern: '^[1-9][0-9]*$' }),
})

const repositoryBodySchema = Type.Object(
  {
    team: Type.String({ minLength: 1, maxLength: 120 }),
    name: Type.String({ minLength: 1, maxLength: 120 }),
    repoUrl: Type.String({ minLength: 1, maxLength: 2048 }),
    displayName: Type.Optional(displayNameSchema),
    year: Type.Optional(yearSchema),
  },
  { additionalProperties: false },
)

/** Una tanda es un curso: de sobra para 10 a 20 equipos. */
const BATCH_MAX = 60

const batchBodySchema = Type.Object(
  {
    year: Type.Optional(yearSchema),
    items: Type.Array(
      Type.Object(
        {
          team: Type.String({ minLength: 1, maxLength: 120 }),
          name: Type.String({ minLength: 1, maxLength: 120 }),
          repoUrl: Type.String({ minLength: 1, maxLength: 2048 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: BATCH_MAX },
    ),
  },
  { additionalProperties: false },
)

const editBodySchema = Type.Object(
  {
    team: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    /** Puede quedar vacía: así se borran. */
    notes: Type.Optional(Type.String({ maxLength: NOTES_MAX_LENGTH })),
    displayName: Type.Optional(displayNameSchema),
    year: Type.Optional(yearSchema),
    description: Type.Optional(Type.String({ maxLength: DESCRIPTION_MAX_LENGTH })),
    instructions: Type.Optional(Type.String({ maxLength: INSTRUCTIONS_MAX_LENGTH })),
    contacts: Type.Optional(Type.Array(contactSchema, { maxItems: CONTACTS_MAX })),
  },
  // Value.Check no quita las claves desconocidas, como hace Fastify: con ellas, la petición no es válida.
  { additionalProperties: false, minProperties: 1 },
)

const registrationParamsSchema = Type.Object({
  key: Type.String({ pattern: '^[0-9a-f-]{36}$' }),
})

type ListQuery = Static<typeof listQuerySchema>
type RegistrationParams = Static<typeof registrationParamsSchema>
type EditBody = Static<typeof editBodySchema>
type IdParams = Static<typeof idParamsSchema>
type RepositoryBody = Static<typeof repositoryBodySchema>
type BatchBody = Static<typeof batchBodySchema>

interface MultipartProject {
  team: string
  name: string
  displayName?: string
  year?: number
  filePath: string
  originalFilename: string
}

export function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, `Falta ${label}.`)
  }
  return value.trim()
}

export function validateRepositoryUrl(value: string): string {
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

interface MultipartZip {
  fields: Map<string, string>
  filePath: string
  originalFilename: string
}

/** Lee un formulario con un archivo ZIP en el campo "file" y lo guarda en temporaryDir. */
export async function readMultipartZip(
  request: FastifyRequest,
  temporaryDir: string,
): Promise<MultipartZip> {
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
  return { fields, filePath, originalFilename }
}

async function readMultipartProject(
  request: FastifyRequest,
  temporaryDir: string,
): Promise<MultipartProject> {
  const { fields, filePath, originalFilename } = await readMultipartZip(request, temporaryDir)
  const displayName = fields.get('displayName')?.trim()
  if (displayName !== undefined && !Value.Check(displayNameSchema, displayName)) {
    throw new HttpError(400, `El nombre para mostrar debe tener entre 1 y ${DISPLAY_NAME_MAX_LENGTH} caracteres.`)
  }
  const yearText = fields.get('year')
  const year = yearText === undefined || yearText === '' ? undefined : Number(yearText)
  if (year !== undefined && !Value.Check(yearSchema, year)) {
    throw new HttpError(400, `El año debe estar entre ${YEAR.minimum} y ${YEAR.maximum}.`)
  }
  return {
    team: requiredText(fields.get('team'), 'el nombre del equipo'),
    name: requiredText(fields.get('name'), 'el nombre del proyecto'),
    displayName: displayName || undefined,
    year,
    filePath,
    originalFilename,
  }
}

/** Lee la imagen del campo "file" de un formulario, con su límite de tamaño. */
async function readMultipartImage(request: FastifyRequest): Promise<Buffer> {
  for await (const part of request.parts()) {
    if (part.type === 'field') continue
    if (part.fieldname !== 'file') {
      part.file.resume()
      continue
    }
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of part.file) {
      size += chunk.length
      if (size > IMAGE_MAX_BYTES) {
        // Se sigue leyendo sin guardar: así la petición termina y el docente recibe el motivo.
        part.file.resume()
        await new Promise((done) => part.file.on('end', done))
        throw new HttpError(400, 'La imagen supera el límite de 2 MB. Usa una más pequeña.')
      }
      chunks.push(chunk)
    }
    return Buffer.concat(chunks)
  }
  throw new HttpError(400, 'Falta el archivo de la imagen.')
}

export function projectRoutes(service: ProjectService): FastifyPluginAsync {
  return async function routes(fastify) {
    const app = fastify.withTypeProvider<TypeBoxTypeProvider>()

    app.get<{ Querystring: ListQuery }>(
      '/projects',
      { schema: { querystring: listQuerySchema } },
      async (request) => {
        const { q, year } = request.query
        return service.list(q, year === undefined || year === 'todos' ? undefined : Number(year))
      },
    )

    app.get('/projects/years', async () => service.years())

    app.get('/projects/resources', async () => service.resources())

    app.post('/projects/stop-all', async () => service.stopAll())

    app.get<{ Params: IdParams }>(
      '/projects/:id',
      { schema: { params: idParamsSchema } },
      async (request) => service.get(Number(request.params.id)),
    )

    app.get('/registrations', async () => service.registrations())

    app.delete<{ Params: RegistrationParams }>(
      '/registrations/:key',
      { schema: { params: registrationParamsSchema } },
      async (request, reply) => {
        service.dismissRegistration(request.params.key)
        return reply.code(204).send()
      },
    )

    app.post('/projects', async (request, reply) => {
      // Registrar sigue aunque se cierre la pestaña; si falla así, el motivo queda en /registrations.
      const abandoned = () => request.raw.socket?.destroyed ?? false
      if (request.isMultipart()) {
        const temporaryDir = await mkdtemp(join(tmpdir(), 'dockyard-'))
        let project
        try {
          const input = await readMultipartProject(request, temporaryDir)
          project = await service.register({
            team: input.team,
            name: input.name,
            displayName: input.displayName,
            year: input.year,
            source: { type: 'zip', filePath: input.filePath },
            sourceLabel: input.originalFilename,
            abandoned,
          })
        } finally {
          await rm(temporaryDir, { recursive: true, force: true })
        }
        return reply.code(201).send(project)
      }

      if (!Value.Check(repositoryBodySchema, request.body)) {
        throw new HttpError(
          400,
          `Debes indicar equipo, nombre del proyecto y URL del repositorio. El nombre para mostrar tiene hasta ${DISPLAY_NAME_MAX_LENGTH} caracteres y el año va de ${YEAR.minimum} a ${YEAR.maximum}.`,
        )
      }

      const body = request.body as RepositoryBody
      const team = requiredText(body.team, 'el nombre del equipo')
      const name = requiredText(body.name, 'el nombre del proyecto')
      const repoUrl = validateRepositoryUrl(body.repoUrl)
      const project = await service.register({
        team,
        name,
        displayName: body.displayName?.trim() || undefined,
        year: body.year,
        source: { type: 'git', url: repoUrl },
        sourceLabel: repoUrl,
        abandoned,
      })
      return reply.code(201).send(project)
    })

    app.post('/projects/batch', async (request, reply) => {
      if (!Value.Check(batchBodySchema, request.body)) {
        throw new HttpError(400, `La lista debe tener entre 1 y ${BATCH_MAX} proyectos, cada uno con equipo, nombre y URL del repositorio, y el año va de ${YEAR.minimum} a ${YEAR.maximum}.`)
      }
      const { year, items } = request.body as BatchBody
      // Las URL que no sirven se rechazan aquí, una por una, sin frenar al resto de la tanda.
      const rejected: { index: number; name: string; message: string }[] = []
      const accepted: { index: number; input: Parameters<ProjectService['enqueue']>[0][number] }[] = []
      items.forEach((item, index) => {
        try {
          const repoUrl = validateRepositoryUrl(item.repoUrl.trim())
          const team = requiredText(item.team, 'el nombre del equipo')
          const name = requiredText(item.name, 'el nombre del proyecto')
          accepted.push({ index, input: { team, name, year, source: { type: 'git', url: repoUrl }, sourceLabel: repoUrl } })
        } catch (error) {
          rejected.push({ index, name: item.name, message: error instanceof Error ? error.message : 'Línea no válida.' })
        }
      })
      const result = service.enqueue(accepted.map((item) => item.input))
      for (const failure of result.rejected) rejected.push({ ...failure, index: accepted[failure.index]!.index })
      rejected.sort((a, b) => a.index - b.index)
      return reply.code(202).send({ queued: result.queued, rejected })
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

    app.patch<{ Params: IdParams }>(
      '/projects/:id',
      { schema: { params: idParamsSchema } },
      async (request) => {
        if (!Value.Check(editBodySchema, request.body)) {
          throw new HttpError(400, `Revisa los datos de la ficha: el equipo, el nombre y el nombre para mostrar no pueden quedar vacíos; el año va de ${YEAR.minimum} a ${YEAR.maximum}; las notas y la descripción tienen hasta ${NOTES_MAX_LENGTH} caracteres y las indicaciones hasta ${INSTRUCTIONS_MAX_LENGTH}; hay hasta ${CONTACTS_MAX} contactos, cada uno con nombre y, si tiene, un correo válido.`)
        }
        const body = request.body as EditBody
        return service.edit(Number(request.params.id), {
          team: body.team === undefined ? undefined : requiredText(body.team, 'el nombre del equipo'),
          name: body.name === undefined ? undefined : requiredText(body.name, 'el nombre del proyecto'),
          notes: body.notes?.trim(),
          displayName: body.displayName === undefined ? undefined : requiredText(body.displayName, 'el nombre para mostrar'),
          year: body.year,
          description: body.description?.trim(),
          instructions: body.instructions?.trim(),
          contacts: body.contacts?.map((contact) => ({
            name: requiredText(contact.name, 'el nombre del contacto'),
            ...(contact.email?.trim() ? { email: contact.email.trim() } : {}),
            ...(contact.phone?.trim() ? { phone: contact.phone.trim() } : {}),
          })),
        })
      },
    )

    app.get<{ Params: IdParams }>(
      '/projects/:id/image',
      { schema: { params: idParamsSchema } },
      async (request, reply) => {
        const { bytes, contentType } = await service.image(Number(request.params.id))
        return reply
          .header('Content-Type', contentType)
          // El tipo sale de los bytes del archivo: el navegador no debe adivinar otro.
          .header('X-Content-Type-Options', 'nosniff')
          .header('Cache-Control', 'no-cache')
          .send(bytes)
      },
    )

    app.put<{ Params: IdParams }>(
      '/projects/:id/image',
      { schema: { params: idParamsSchema } },
      async (request) => {
        if (!request.isMultipart()) throw new HttpError(400, 'Falta el archivo de la imagen.')
        const id = Number(request.params.id)
        return service.setImage(id, await readMultipartImage(request))
      },
    )

    app.delete<{ Params: IdParams }>(
      '/projects/:id/image',
      { schema: { params: idParamsSchema } },
      async (request) => service.removeImage(Number(request.params.id)),
    )

    app.post<{ Params: IdParams }>(
      '/projects/:id/start',
      { schema: { params: idParamsSchema } },
      async (request) => service.start(Number(request.params.id)),
    )

    app.post<{ Params: IdParams }>(
      '/projects/:id/update',
      { schema: { params: idParamsSchema } },
      async (request) => service.update(Number(request.params.id)),
    )

    app.post<{ Params: IdParams }>(
      '/projects/:id/reset-data',
      { schema: { params: idParamsSchema } },
      async (request) => service.resetData(Number(request.params.id)),
    )

    app.post<{ Params: IdParams }>(
      '/projects/:id/replace',
      { schema: { params: idParamsSchema } },
      async (request) => {
        if (!request.isMultipart()) throw new HttpError(400, 'Falta el archivo ZIP del proyecto.')
        // El ZIP se borra al terminar, salga bien o mal, igual que al registrar.
        const temporaryDir = await mkdtemp(join(tmpdir(), 'dockyard-'))
        try {
          const { filePath, originalFilename } = await readMultipartZip(request, temporaryDir)
          return await service.replace(Number(request.params.id), { filePath, sourceLabel: originalFilename })
        } finally {
          await rm(temporaryDir, { recursive: true, force: true })
        }
      },
    )

    app.post<{ Params: IdParams }>(
      '/projects/:id/stop',
      { schema: { params: idParamsSchema } },
      async (request) => service.stop(Number(request.params.id)),
    )
  }
}
