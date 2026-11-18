import { assertNormalizedName } from './name.ts'
import { docker } from './docker.ts'
import { parseBytes } from './resources.ts'
import { CommandError } from './run.ts'
import type { DiskUsage, ImagesPruned, ProjectDiskUsage } from './types.ts'

/** `system df -v` mide los volúmenes uno por uno: con muchos datos tarda. */
const DF_TIMEOUT = 120_000
const RM_TIMEOUT = 60_000
const PROJECT_LABEL = 'com.docker.compose.project'

/** Una imagen que construyó un proyecto de compose, según `system df -v` e `image inspect`. */
export interface ProjectImage {
  id: string
  project: string
  /** Lo que ocupa con sus capas compartidas. */
  bytes: number
  /** Lo que se recupera al borrarla si nadie más usa sus capas. */
  uniqueBytes: number
  containers: number
  /** Sin nombre: una versión anterior que quedó al reconstruir. */
  dangling: boolean
}

/** Etiqueta de proyecto de compose dentro del texto Labels ("a=1,com.docker.compose.project=x"). */
function projectOfLabels(labels: string): string | null {
  return /(?:^|,)com\.docker\.compose\.project=([^,]+)/.exec(labels)?.[1] ?? null
}

/**
 * Une `system df -v` (tamaño y contenedores de cada imagen) con el proyecto de compose de las
 * imágenes que lo llevan en su etiqueta. Compose etiqueta las imágenes que construye (`build:`),
 * no las que descarga (`image: postgres`), y las versiones viejas conservan la etiqueta.
 */
export function projectImagesFrom(df: any, projectById: Map<string, string>): ProjectImage[] {
  const result: ProjectImage[] = []
  for (const image of df?.Images ?? []) {
    const id = String(image.ID ?? '')
    const project = projectById.get(id)
    if (!project) continue
    const bytes = parseBytes(String(image.Size ?? ''))
    const unique = parseBytes(String(image.UniqueSize ?? ''))
    result.push({
      id,
      project,
      bytes,
      // Algunas versiones de Docker no calculan UniqueSize ("N/A").
      uniqueBytes: /^[\d.]+\s*[a-z]+$/i.test(String(image.UniqueSize ?? '').trim()) ? unique : bytes,
      containers: Number(image.Containers) || 0,
      dangling: image.Repository === '<none>' && image.Tag === '<none>',
    })
  }
  return result
}

/**
 * Lo que se puede borrar sin tocar nada en uso: versiones viejas, es decir, imágenes sin nombre
 * que ningún contenedor usa, ni siquiera uno apagado. La imagen actual de un proyecto se conserva
 * aunque no tenga contenedores (tras Reiniciar datos), para no reconstruirla al encender.
 */
export function isOldVersion(image: ProjectImage): boolean {
  return image.dangling && image.containers === 0
}

/** Suma por proyecto de compose lo que ocupan sus imágenes y sus volúmenes. */
export function diskUsageFrom(images: ProjectImage[], volumes: any[]): DiskUsage {
  const projects: Record<string, ProjectDiskUsage> = {}
  const entry = (name: string) => projects[name] ??= { imageBytes: 0, unusedImageBytes: 0, volumeBytes: 0 }
  for (const image of images) {
    if (isOldVersion(image)) entry(image.project).unusedImageBytes += image.uniqueBytes
    else entry(image.project).imageBytes += image.bytes
  }
  for (const volume of volumes) {
    const project = projectOfLabels(String(volume.Labels ?? ''))
    if (project) entry(project).volumeBytes += parseBytes(String(volume.Size ?? ''))
  }
  return { projects }
}

async function readDf(): Promise<any> {
  return JSON.parse(await docker(['system', 'df', '-v', '--format', 'json'], { timeoutMs: DF_TIMEOUT }))
}

/** Proyecto de compose de cada imagen que lleva su etiqueta, con una sola consulta. */
async function labeledImages(): Promise<Map<string, string>> {
  const ids = (await docker(['image', 'ls', '-aq', '--no-trunc', '--filter', `label=${PROJECT_LABEL}`], { timeoutMs: DF_TIMEOUT }))
    .split('\n').map((id) => id.trim()).filter(Boolean)
  const byId = new Map<string, string>()
  if (ids.length === 0) return byId
  const out = await docker(
    ['image', 'inspect', '--format', `{{.Id}} {{index .Config.Labels "${PROJECT_LABEL}"}}`, ...new Set(ids)],
    { timeoutMs: DF_TIMEOUT },
  )
  for (const line of out.split('\n')) {
    const [id, project] = line.trim().split(' ')
    if (id && project) byId.set(id, project)
  }
  return byId
}

async function projectImages(): Promise<{ df: any; images: ProjectImage[] }> {
  const [df, byId] = await Promise.all([readDf(), labeledImages()])
  return { df, images: projectImagesFrom(df, byId) }
}

/** Lo que ocupan todas las imágenes de Docker, según `system df`: sirve para medir lo liberado. */
async function totalImageBytes(): Promise<number> {
  const out = await docker(['system', 'df', '--format', 'json'], { timeoutMs: DF_TIMEOUT })
  const rows = out.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  return parseBytes(String(rows.find((row) => row.Type === 'Images')?.Size ?? ''))
}

function dockerFailure(action: string, err: unknown): never {
  if (err instanceof CommandError) {
    throw new Error(`No se pudo ${action}. Docker respondió: ${err.stderr.split('\n').slice(-2).join(' ')}`)
  }
  throw err
}

/**
 * Lo que ocupa cada proyecto de compose de la PC: sus imágenes construidas, sus versiones viejas
 * y sus volúmenes. Devuelve todos los proyectos; la API deja solo los registrados.
 */
export async function getDiskUsage(): Promise<DiskUsage> {
  try {
    const { df, images } = await projectImages()
    return diskUsageFrom(images, df?.Volumes ?? [])
  } catch (err) {
    dockerFailure('medir el espacio en disco', err)
  }
}

/**
 * Borra las versiones viejas de las imágenes de esos proyectos (ver isOldVersion). Nunca borra
 * volúmenes, imágenes de otros proyectos ni la caché de construcción: `docker builder prune` y
 * `docker system prune` son de toda la PC. Devuelve cuánto bajó lo que ocupan las imágenes.
 */
export async function pruneProjectImages(names: string[]): Promise<ImagesPruned> {
  names.forEach(assertNormalizedName)
  const wanted = new Set(names)
  try {
    const before = await totalImageBytes()
    const { images } = await projectImages()
    let removed = 0
    for (const image of images.filter((item) => wanted.has(item.project) && isOldVersion(item))) {
      try {
        // Sin -f: si un contenedor empezó a usarla mientras tanto, Docker se niega y se deja.
        await docker(['image', 'rm', image.id], { timeoutMs: RM_TIMEOUT })
        removed++
      } catch (err) {
        if (!(err instanceof CommandError)) throw err
      }
    }
    const after = removed > 0 ? await totalImageBytes() : before
    return { freedBytes: Math.max(0, before - after), removed }
  } catch (err) {
    dockerFailure('liberar espacio', err)
  }
}
