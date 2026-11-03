import { buildApp } from './app.ts'

const portValue = Number(process.env.PORT ?? 4300)
const port = Number.isInteger(portValue) && portValue > 0 ? portValue : 4300
const app = await buildApp({ logger: true, serveWeb: true })

async function close(signal: string): Promise<void> {
  app.log.info({ signal }, 'Cerrando Dockyard')
  await app.close()
  process.exit(0)
}

process.on('SIGINT', () => void close('SIGINT'))
process.on('SIGTERM', () => void close('SIGTERM'))

try {
  await app.listen({ host: '0.0.0.0', port })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
