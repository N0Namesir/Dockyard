import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'
import * as realCore from './core.ts'
import {
  createProjectRepository,
  type ProjectRepository,
} from './db/projects.ts'
import { errorMessage, HttpError } from './errors.ts'
import { projectRoutes } from './routes/projects.ts'
import { createProjectService } from './services/projects.ts'
import type { CoreAdapter } from './types.ts'

export interface AppOptions {
  repository?: ProjectRepository
  core?: CoreAdapter
  logger?: boolean
  serveWeb?: boolean
  webRoot?: string
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false })
  const repository = options.repository ?? createProjectRepository()
  const core = options.core ?? realCore

  // Debe definirse antes de registrar las rutas: un plugin hereda el manejador que existe al registrarlo.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({ message: error.message })
    }

    const fastifyError = error as { code?: string; statusCode?: number }
    if (fastifyError.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply
        .code(400)
        .send({ message: 'El archivo ZIP supera el límite permitido de 200 MB.' })
    }
    if (fastifyError.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      return reply
        .code(415)
        .send({ message: 'La petición debe enviarse como JSON o como formulario con archivo.' })
    }

    const statusCode = fastifyError.statusCode ?? 500
    if (statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({ message: 'La petición no tiene un formato válido.' })
    }

    // Las fallas del núcleo traen un mensaje pensado para el docente y se devuelven tal cual.
    request.log.error(error)
    return reply.code(500).send({ message: errorMessage(error) })
  })

  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ message: 'La ruta solicitada no existe.' }),
  )

  await app.register(multipart, {
    limits: { files: 1, fileSize: 200 * 1024 * 1024, fields: 10 },
  })

  const service = createProjectService(repository, core)
  await app.register(projectRoutes(service), { prefix: '/api' })

  const webRoot = options.webRoot ?? resolve(import.meta.dirname, '../../web/dist')
  if ((options.serveWeb ?? false) && existsSync(webRoot)) {
    await app.register(fastifyStatic, {
      root: webRoot,
      index: ['index.html'],
    })
  }

  app.addHook('onClose', async () => repository.close())
  return app
}
