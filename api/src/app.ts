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

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({ message: error.message })
    }

    const fastifyError = error as { code?: string; statusCode?: number }
    if (fastifyError.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply
        .code(400)
        .send({ message: 'El archivo ZIP supera el límite permitido de 200 MB.' })
    }

    const statusCode = fastifyError.statusCode === 400 ? 400 : 500
    const message =
      statusCode === 400 ? 'La petición no tiene un formato válido.' : errorMessage(error)
    return reply.code(statusCode).send({ message })
  })

  app.addHook('onClose', async () => repository.close())
  return app
}
