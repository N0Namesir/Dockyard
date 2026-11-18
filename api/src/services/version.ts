import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getLatestVersion, isNewerVersion } from '../core.ts'
import { HttpError } from '../errors.ts'

const DOCKYARD_REPO = 'https://github.com/N0Namesir/Dockyard.git'
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

export interface VersionInfo {
  current: string
  latest: string | null
  updateAvailable: boolean
  /** Última consulta a GitHub que respondió; null si aún no hubo ninguna. */
  checkedAt: string | null
}

/**
 * Llamarla devuelve lo que se sabe y, si toca, consulta GitHub (como máximo cada 6 horas y solo
 * con la consulta automática encendida). checkNow consulta siempre y falla si GitHub no responde.
 */
export interface CheckVersion {
  (): Promise<VersionInfo>
  checkNow(): Promise<VersionInfo>
}

export interface VersionCheckerOptions {
  current?: string
  /** Consulta automática. Una función se lee en cada llamada: el docente la cambia en Configuración. */
  enabled?: boolean | (() => boolean)
  fetchLatest?: () => Promise<string | null>
  now?: () => number
  onError?: (error: unknown) => void
}

/** La versión instalada es la del package.json de la raíz, que también está dentro de la imagen. */
export function installedVersion(): string {
  const path = resolve(import.meta.dirname, '../../../package.json')
  return String(JSON.parse(readFileSync(path, 'utf8')).version)
}

/** UPDATE_CHECK=off en .env apaga la consulta automática mientras el docente no la cambie. */
export function updateCheckFromEnv(): boolean {
  return process.env.UPDATE_CHECK?.trim().toLowerCase() !== 'off'
}

/**
 * Compara la versión instalada con la última etiqueta del repositorio. La consulta automática es un
 * dato de apoyo: sin internet nunca rechaza, conserva lo último que supo y espera 6 horas.
 */
export function createVersionChecker(options: VersionCheckerOptions = {}): CheckVersion {
  const current = options.current ?? installedVersion()
  const option = options.enabled ?? updateCheckFromEnv
  const enabled = typeof option === 'function' ? option : () => option
  const fetchLatest = options.fetchLatest ?? (() => getLatestVersion(DOCKYARD_REPO))
  const now = options.now ?? Date.now

  let latest: string | null = null
  let checkedAt: number | undefined
  let answeredAt: number | null = null
  let checking: Promise<void> | undefined

  function info(): VersionInfo {
    return {
      current,
      latest,
      updateAvailable: latest !== null && isNewerVersion(latest, current),
      checkedAt: answeredAt === null ? null : new Date(answeredAt).toISOString(),
    }
  }

  /** Una sola consulta a la vez: las demás esperan la misma. */
  function refresh(): Promise<void> {
    checkedAt = now()
    checking ??= fetchLatest()
      .then((value) => {
        latest = value
        answeredAt = now()
      })
      .finally(() => {
        checking = undefined
      })
    return checking
  }

  const check = async () => {
    if (enabled() && (checkedAt === undefined || now() - checkedAt >= CHECK_EVERY_MS)) {
      await refresh().catch((error) => options.onError?.(error))
    } else {
      await checking?.catch(() => {})
    }
    return info()
  }

  return Object.assign(check, {
    async checkNow() {
      try {
        await refresh()
      } catch (error) {
        options.onError?.(error)
        throw new HttpError(502, 'No se pudo consultar GitHub. Revisa la conexión a internet y vuelve a intentarlo.')
      }
      return info()
    },
  })
}
