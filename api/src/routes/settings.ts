import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { Type, type Static } from '@sinclair/typebox'
import type { FastifyPluginAsync } from 'fastify'
import { HttpError } from '../errors.ts'
import type { createSelfUpdate } from '../services/self-update.ts'
import type { SettingsStore } from '../services/settings.ts'

const settingsBodySchema = Type.Object(
  { updateCheck: Type.Optional(Type.Boolean()) },
  { additionalProperties: false, minProperties: 1 },
)

type SettingsBody = Static<typeof settingsBodySchema>

export function settingsRoutes(
  settings: SettingsStore,
  selfUpdate: ReturnType<typeof createSelfUpdate>,
): FastifyPluginAsync {
  return async (fastify) => {
    const app = fastify.withTypeProvider<TypeBoxTypeProvider>()
    app.get('/settings', () => settings.get())

    app.patch<{ Body: SettingsBody }>(
      '/settings',
      { schema: { body: settingsBodySchema } },
      (request) => {
        // Fastify quita los campos desconocidos antes de validar: sin un ajuste conocido, no hay cambio.
        if (request.body.updateCheck === undefined) {
          throw new HttpError(400, 'Indica qué ajuste cambiar.')
        }
        return settings.update(request.body)
      },
    )

    app.get('/update', () => selfUpdate.status())

    app.post('/update', async (_request, reply) => reply.code(202).send(await selfUpdate.start()))
  }
}
