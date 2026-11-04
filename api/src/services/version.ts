import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getLatestVersion, isNewerVersion } from '../core.ts'

const DOCKYARD_REPO = 'https://github.com/N0Namesir/Dockyard.git'
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

export interface VersionInfo {
  current: string
  latest: string | null
  updateAvailable: boolean
}

export type CheckVersion = () => Promise<VersionInfo>

export interface VersionCheckerOptions {
  current?: string
  /** UPDATE_CHECK=off apaga toda conexión a GitHub para esta comprobación. */
  enabled?: boolean
  fetchLatest?: () => Promise<string | null>
  now?: () => number
  onError?: (error: unknown) => void
}

/** La versión instalada es la del package.json de la raíz, que también está dentro de la imagen. */
function installedVersion(): string {
  const path = resolve(import.meta.dirname, '../../../package.json')
  return String(JSON.parse(readFileSync(path, 'utf8')).version)
}

/**
 * Compara la versión instalada con la última etiqueta del repositorio. Solo consulta cuando se le
 * pide y como máximo cada 6 horas, también si la consulta falló. Es un dato de apoyo: sin internet
 * nunca rechaza y conserva lo último que supo.
 */
export function createVersionChecker(options: VersionCheckerOptions = {}): CheckVersion {
  const current = options.current ?? installedVersion()
  const enabled = options.enabled ?? process.env.UPDATE_CHECK?.trim().toLowerCase() !== 'off'
  const fetchLatest = options.fetchLatest ?? (() => getLatestVersion(DOCKYARD_REPO))
  const now = options.now ?? Date.now

  let latest: string | null = null
  let checkedAt: number | undefined
  let checking: Promise<void> | undefined

  async function refresh(): Promise<void> {
    try {
      latest = await fetchLatest()
    } catch (error) {
      options.onError?.(error)
    } finally {
      checking = undefined
    }
  }

  return async () => {
    if (enabled && (checkedAt === undefined || now() - checkedAt >= CHECK_EVERY_MS)) {
      checkedAt = now()
      checking = refresh()
    }
    await checking
    return { current, latest, updateAvailable: latest !== null && isNewerVersion(latest, current) }
  }
}
