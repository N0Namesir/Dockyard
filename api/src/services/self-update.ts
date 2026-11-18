// Actualizar Dockyard desde Configuración. El núcleo lanza update.sh en un contenedor auxiliar, que
// deja su salida y su código de salida en la carpeta de datos; aquí solo se decide si se puede
// empezar y se lee el resultado, también después de que Dockyard se reinició.
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { SELF_UPDATE_EXIT_CODE, SELF_UPDATE_LOG } from '../core.ts'
import { HttpError } from '../errors.ts'
import type { CoreAdapter } from '../types.ts'
import type { CheckVersion } from './version.ts'

const LOG_LINES = 80

export interface SelfUpdateResponse {
  /** false si Dockyard no corre instalado con install.sh (por ejemplo, en desarrollo). */
  supported: boolean
  running: boolean
  /** La última actualización desde la página; null si nunca hubo una. */
  last: {
    /** null si se cortó antes de terminar o si aún corre. */
    exitCode: number | null
    finishedAt: string | null
    /** Últimas líneas de la salida de update.sh. */
    log: string
  } | null
}

export interface SelfUpdateOptions {
  core: Pick<CoreAdapter, 'getSelfUpdateStatus' | 'startSelfUpdate'>
  dataDir: string
  checkVersion: CheckVersion
  /** true si un encendido, apagado o registro se cortaría al reiniciar Dockyard. */
  busy: () => boolean
}

async function readLast(dataDir: string): Promise<SelfUpdateResponse['last']> {
  const log = await readFile(join(dataDir, SELF_UPDATE_LOG), 'utf8').catch(() => null)
  if (log === null) return null
  const exitPath = join(dataDir, SELF_UPDATE_EXIT_CODE)
  const exitText = await readFile(exitPath, 'utf8').catch(() => null)
  const exitCode = exitText === null || !/^\d+$/.test(exitText.trim()) ? null : Number(exitText.trim())
  const finishedAt = exitCode === null ? null : (await stat(exitPath)).mtime.toISOString()
  return { exitCode, finishedAt, log: log.trimEnd().split('\n').slice(-LOG_LINES).join('\n') }
}

export function createSelfUpdate({ core, dataDir, checkVersion, busy }: SelfUpdateOptions) {
  async function status(): Promise<SelfUpdateResponse> {
    const { supported, running } = await core.getSelfUpdateStatus()
    return { supported, running, last: supported ? await readLast(dataDir) : null }
  }

  return {
    status,

    async start(): Promise<SelfUpdateResponse> {
      if (!(await checkVersion()).updateAvailable) {
        throw new HttpError(409, 'Ya tienes la última versión publicada. Usa Comprobar ahora si acabas de publicar una.')
      }
      if (busy()) {
        throw new HttpError(409, 'Hay proyectos encendiéndose, apagándose o registrándose, y Dockyard se reinicia al actualizar. Espera a que terminen.')
      }
      await core.startSelfUpdate()
      return status()
    },
  }
}
