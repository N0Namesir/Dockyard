import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { HttpError } from '../errors.ts'
import { EXPORT_FORMAT, type BackupService, type ExportFile } from '../services/backup.ts'
import { readMultipartZip, validateRepositoryUrl } from './projects.ts'
import { CONTACTS_MAX, contactSchema, DESCRIPTION_MAX_LENGTH, displayNameSchema, INSTRUCTIONS_MAX_LENGTH, NOTES_MAX_LENGTH, yearSchema } from './schemas.ts'

/** Un archivo con muchas imágenes pesa varios MB: el límite general de Fastify es 1 MB. */
const IMPORT_BODY_LIMIT = 100 * 1024 * 1024
/** Una imagen de 2 MB ocupa unos 2,7 MB en base64. */
const IMAGE_BASE64_MAX = Math.ceil((2 * 1024 * 1024 * 4) / 3) + 4

const importSchema = Type.Object({
  format: Type.Literal(EXPORT_FORMAT),
  dockyard: Type.Optional(Type.String({ maxLength: 40 })),
  exportedAt: Type.Optional(Type.String({ maxLength: 40 })),
  projects: Type.Array(
    Type.Object({
      name: Type.String({ minLength: 1, maxLength: 120 }),
      displayName: Type.Optional(displayNameSchema),
      team: Type.String({ minLength: 1, maxLength: 120 }),
      year: Type.Optional(yearSchema),
      sourceType: Type.Union([Type.Literal('git'), Type.Literal('zip')]),
      repoUrl: Type.Optional(Type.String({ maxLength: 2048 })),
      zipName: Type.Optional(Type.String({ maxLength: 255 })),
      notes: Type.Optional(Type.String({ maxLength: NOTES_MAX_LENGTH })),
      description: Type.Optional(Type.String({ maxLength: DESCRIPTION_MAX_LENGTH })),
      instructions: Type.Optional(Type.String({ maxLength: INSTRUCTIONS_MAX_LENGTH })),
      contacts: Type.Optional(Type.Array(contactSchema, { maxItems: CONTACTS_MAX })),
      image: Type.Optional(Type.Union([
        Type.Null(),
        Type.Object({
          type: Type.Union([Type.Literal('png'), Type.Literal('jpg'), Type.Literal('webp')]),
          data: Type.String({ maxLength: IMAGE_BASE64_MAX, pattern: '^[A-Za-z0-9+/]*={0,2}$' }),
        }),
      ])),
    }),
    { maxItems: 1000 },
  ),
})

const pendingParamsSchema = Type.Object({ name: Type.String({ pattern: '^[a-z0-9][a-z0-9_-]{0,119}$' }) })
type PendingParams = Static<typeof pendingParamsSchema>

function importFile(request: FastifyRequest): ExportFile {
  if (!Value.Check(importSchema, request.body)) {
    throw new HttpError(400, 'El archivo no es una lista exportada por Dockyard o está dañado. Exporta la lista de nuevo y vuelve a intentarlo.')
  }
  return request.body as ExportFile
}

export function backupRoutes(backup: BackupService): FastifyPluginAsync {
  return async (app) => {
    app.get('/export', async (_request, reply) => {
      const date = new Date().toISOString().slice(0, 10)
      return reply
        .header('Content-Disposition', `attachment; filename="dockyard-proyectos-${date}.json"`)
        .header('Cache-Control', 'no-store')
        .type('application/json; charset=utf-8')
        .send(JSON.stringify(await backup.exportList(), null, 2))
    })

    app.post('/import/preview', { bodyLimit: IMPORT_BODY_LIMIT }, async (request) => ({ projects: backup.preview(importFile(request)) }))

    app.post('/import', { bodyLimit: IMPORT_BODY_LIMIT }, async (request) =>
      backup.apply(importFile(request), (url) => validateRepositoryUrl(url.trim())))

    app.get('/import/pending', async () => backup.pending())

    app.post<{ Params: PendingParams }>(
      '/import/pending/:name',
      { schema: { params: pendingParamsSchema } },
      async (request, reply) => {
        if (!request.isMultipart()) throw new HttpError(400, 'Falta el archivo ZIP del proyecto.')
        const abandoned = () => request.raw.socket?.destroyed ?? false
        const temporaryDir = await mkdtemp(join(tmpdir(), 'dockyard-'))
        try {
          const { filePath, originalFilename } = await readMultipartZip(request, temporaryDir)
          const project = await backup.registerPending(request.params.name, { filePath, sourceLabel: originalFilename, abandoned })
          return reply.code(201).send(project)
        } finally {
          await rm(temporaryDir, { recursive: true, force: true })
        }
      },
    )

    app.delete<{ Params: PendingParams }>(
      '/import/pending/:name',
      { schema: { params: pendingParamsSchema } },
      async (request, reply) => {
        backup.dismissPending(request.params.name)
        return reply.code(204).send()
      },
    )
  }
}
