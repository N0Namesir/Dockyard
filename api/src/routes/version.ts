import type { FastifyPluginAsync } from 'fastify'
import type { CheckVersion } from '../services/version.ts'

export function versionRoutes(checkVersion: CheckVersion): FastifyPluginAsync {
  return async (app) => {
    app.get('/version', () => checkVersion())
    // Comprobar ahora: consulta GitHub aunque la consulta automática esté apagada o sea reciente.
    app.post('/version/check', () => checkVersion.checkNow())
  }
}
