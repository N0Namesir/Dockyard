import { CommandError, run } from './run.ts'

const LS_REMOTE_TIMEOUT = 15_000
const PART = '(0|[1-9]\\d{0,8})'
const VERSION = new RegExp(`^v?${PART}\\.${PART}\\.${PART}$`)
const TAG_PREFIX = 'refs/tags/'

function parseVersion(version: string): number[] | null {
  const match = VERSION.exec(version)
  return match ? match.slice(1).map(Number) : null
}

/** Indica si `candidate` es posterior a `current`. Una versión con otro formato nunca lo es. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseVersion(candidate)
  const b = parseVersion(current)
  if (!a || !b) return false
  const index = a.findIndex((part, i) => part !== b[i])
  return index !== -1 && a[index]! > b[index]!
}

/** La etiqueta vX.Y.Z más alta de una salida de `git ls-remote --tags`. Ignora cualquier otro formato. */
export function latestVersionTag(lsRemoteOutput: string): string | null {
  let latest: string | null = null
  for (const line of lsRemoteOutput.split('\n')) {
    const ref = line.split('\t')[1]?.trim()
    if (!ref?.startsWith(TAG_PREFIX)) continue
    const tag = ref.slice(TAG_PREFIX.length)
    if (!tag.startsWith('v') || !parseVersion(tag)) continue
    if (latest === null || isNewerVersion(tag, latest)) latest = tag
  }
  return latest
}

/** La versión publicada más reciente de un repositorio, o null si no tiene ninguna. No descarga el repositorio. */
export async function getLatestVersion(repoUrl: string): Promise<string | null> {
  try {
    return latestVersionTag(await run('git', ['ls-remote', '--tags', '--refs', '--', repoUrl], { timeoutMs: LS_REMOTE_TIMEOUT }))
  } catch (err) {
    if (err instanceof CommandError) {
      throw new Error(`No se pudo consultar la última versión de Dockyard. Revisa la conexión a internet. Detalle: ${err.message}`)
    }
    throw err
  }
}
