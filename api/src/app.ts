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
import { createWebChecker, type CheckWeb } from './services/web-check.ts'
import type { CoreAdapter } from './types.ts'

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Nombre del host sin el puerto; null si el valor no es válido. */
function hostnameOf(host: string): string | null {
  try {
    return new URL(`http://${host}`).hostname
  } catch {
    return null
  }
}

/**
 * La herramienta no tiene login y puede ejecutar proyectos con el Docker del anfitrión, así que
 * rechaza lo que venga de otra página, incluidos los proyectos en otros puertos de localhost:
 * - Host local: evita que un dominio ajeno apunte a esta PC (DNS rebinding).
 * - Origin igual a Host: evita que otra página envíe peticiones desde el navegador del docente.
 *   Las peticiones sin Origin, como las de curl, no salen de una página.
 */
export function isAllowedRequest(host: string | undefined, origin: string | undefined): boolean {
  if (!host || !LOCAL_HOSTNAMES.has(hostnameOf(host) ?? '')) return false
  if (origin === undefined) return true
  try {
    return new URL(origin).host === new URL(`http://${host}`).host
  } catch {
    return false
  }
}

export interface AppOptions {
  repository?: ProjectRepository
  core?: CoreAdapter
  checkWeb?: CheckWeb
  logger?: boolean
  serveWeb?: boolean
  webRoot?: string
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false })
  const repository = options.repository ?? createProjectRepository()
  const core = options.core ?? realCore

  app.addHook('onRequest', async (request, reply) => {
    if (!isAllowedRequest(request.headers.host, request.headers.origin)) {
      return reply.code(403).send({
        message: 'Dockyard solo acepta peticiones desde su propia página en esta PC.',
      })
    }
  })

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

  const service = createProjectService(repository, core, options.checkWeb ?? createWebChecker())
  await app.register(projectRoutes(service), { prefix: '/api' })

  const webRoot = options.webRoot ?? resolve(import.meta.dirname, '../../web/dist')
  if ((options.serveWeb ?? false) && existsSync(webRoot)) {
    await app.register(fastifyStatic, {
      root: webRoot,
      index: ['index.html'],
      redirect: true, // /docs lleva a /docs/, donde está su index.html
    })
  }

  app.addHook('onClose', async () => repository.close())
  return app
}
