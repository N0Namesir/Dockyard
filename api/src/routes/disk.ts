import type { FastifyPluginAsync } from 'fastify'
import type { DiskService } from '../services/disk.ts'

export function diskRoutes(disk: DiskService): FastifyPluginAsync {
  return async (app) => {
    app.get('/disk', () => disk.usage())
    app.post('/disk/clean', () => disk.clean())
  }
}
