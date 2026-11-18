import { constants } from 'node:fs'
import { access, copyFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { assertProjectNameFree } from './docker.ts'
import { assertNormalizedName, normalizeProjectName } from './name.ts'
import { findComposeFile, projectRepoDir, projectsDir } from './paths.ts'
import { CommandError, run } from './run.ts'
import type { PreparedProject, PrepareOptions, PrepareProgress, ProjectSource, ProjectUpdate, ZipReplacement } from './types.ts'

const FETCH_TIMEOUT = 5 * 60_000
/** Límites al descomprimir: el ZIP subido no pasa de 200 MB, pero puede ocupar mucho más al abrirse. */
const MAX_ZIP_BYTES = 3 * 1024 ** 3
const MAX_ZIP_ENTRIES = 100_000

/**
 * Crea projects/<nombre>, obtiene el código desde un repositorio o un ZIP y devuelve la carpeta
 * que contiene el archivo compose. Si algo falla a mitad de camino, borra la carpeta que creó.
 */
export async function prepareProject(source: ProjectSource, name: string, options: PrepareOptions = {}): Promise<PreparedProject> {
  const normalized = normalizeProjectName(name)
  validateSource(source)
  // Solo avisa cuando algo cambia: git escribe su avance muchas veces por segundo.
  let last = ''
  const report = (progress: PrepareProgress) => {
    const key = `${progress.stage}|${progress.percent}`
    if (key === last) return
    last = key
    options.onProgress?.(progress)
  }

  const root = projectsDir()
  await mkdir(root, { recursive: true })
  const target = join(root, normalized)
  try {
    await mkdir(target) // sin recursive: falla si ya existe
  } catch (err: any) {
    if (err.code === 'EEXIST') throw new Error(`Ya existe un proyecto con ese nombre en la carpeta de proyectos. Usa otro nombre o, si ese proyecto ya no se usa, borra la carpeta ${target}.`)
    throw err
  }

  try {
    await assertProjectNameFree(normalized)

    if (source.type === 'git') {
      report({ stage: 'Conectando con GitHub', percent: null })
      await cloneRepo(source.url, target, projectRepoDir(normalized), (line) => {
        const progress = cloneProgressOf(line)
        if (progress) report(progress)
      })
    } else {
      report({ stage: 'Descomprimiendo el ZIP', percent: null })
      await extractZip(source.filePath, target)
    }
    report({ stage: 'Buscando el archivo compose', percent: null })

    const location = await findComposeFile(target)
    if (!location) {
      throw new Error('No se encontró un archivo compose en la raíz del proyecto. Debe llamarse compose.yaml, compose.yml, docker-compose.yaml o docker-compose.yml.')
    }

    await copyEnvExample(location.dir)
    return { dir: location.dir, name: normalized }
  } catch (err) {
    await rm(target, { recursive: true, force: true })
    await rm(projectRepoDir(normalized), { recursive: true, force: true })
    throw err
  }
}

function validateSource(source: ProjectSource): void {
  if (source.type === 'git') {
    let url: URL
    try {
      url = new URL(source.url)
    } catch {
      throw new Error('La URL del repositorio no es válida. Debe tener la forma https://github.com/usuario/repositorio.')
    }
    if (url.protocol !== 'https:') {
      throw new Error('Solo se aceptan repositorios con URL https://.')
    }
    if (url.username || url.password) {
      throw new Error('La URL del repositorio no debe incluir usuario ni contraseña. Usa la forma https://github.com/usuario/repositorio.')
    }
  } else if (source.type !== 'zip') {
    throw new Error('Fuente de proyecto desconocida: debe ser un repositorio git o un archivo ZIP.')
  }
}

const CLONE_STAGES: [RegExp, string][] = [
  [/Receiving objects:\s+(\d+)%/, 'Descargando el repositorio'],
  [/Resolving deltas:\s+(\d+)%/, 'Procesando el repositorio'],
  [/Updating files:\s+(\d+)%/, 'Copiando los archivos'],
]

/** Traduce una línea del avance de git clone a una etapa con porcentaje, o null si no es de avance. */
export function cloneProgressOf(line: string): PrepareProgress | null {
  for (const [pattern, stage] of CLONE_STAGES) {
    const match = pattern.exec(line)
    if (match) return { stage, percent: Number(match[1]) }
  }
  return null
}

/** Clona dejando el repositorio en gitDir, fuera de la carpeta del proyecto (ver projectRepoDir). */
export async function cloneRepo(url: string, target: string, gitDir: string, onLine?: (line: string) => void): Promise<void> {
  await mkdir(dirname(gitDir), { recursive: true })
  await rm(gitDir, { recursive: true, force: true })
  try {
    // "--" evita que una URL que empiece con "-" se interprete como opción.
    // --progress: sin una terminal, git solo informa su avance si se lo piden.
    await run('git', ['clone', '--progress', '--depth', '1', '--separate-git-dir', gitDir, '--', url, target], { timeoutMs: FETCH_TIMEOUT, onLine })
    await rm(join(target, '.git'), { force: true })
  } catch (err) {
    if (err instanceof CommandError) {
      if (err.timedOut) throw new Error('El clonado del repositorio tardó más de 5 minutos y se canceló.')
      if (/could not read Username|terminal prompts disabled|Authentication failed|not found/i.test(err.stderr)) {
        throw new Error('No se pudo clonar el repositorio. Verifica que la URL sea correcta y que el repositorio sea público: los repositorios privados no se admiten en esta versión.')
      }
      // Sin las líneas de avance, que con --progress llenan la salida de errores.
      const detail = err.stderr.split(/[\r\n]+/).filter((line) => !/:\s+\d+%/.test(line)).slice(-3).join(' ')
      throw new Error(`No se pudo clonar el repositorio: ${detail}`)
    }
    throw err
  }
}

/**
 * Trae la última versión de un proyecto de GitHub. Conserva lo que no viene en el repositorio,
 * como .env y los datos, y no acepta pisar archivos cambiados en la PC. El clonado es superficial
 * y read-tree no necesita historia en común, así que también funciona si el equipo reescribió la
 * historia. No enciende ni reconstruye nada.
 */
export async function updateProject(name: string): Promise<ProjectUpdate> {
  assertNormalizedName(name)
  const root = join(projectsDir(), name)
  const gitDir = projectRepoDir(name)
  const exists = await stat(gitDir).then((info) => info.isDirectory(), () => false)
  if (!exists) {
    throw new Error('Este proyecto no se puede actualizar porque se registró antes de que existiera esta función o desde un ZIP. Elimínalo y regístralo de nuevo.')
  }
  const git = (args: string[], okExitCodes?: number[]) =>
    run('git', ['--git-dir', gitDir, '--work-tree', root, ...args], { timeoutMs: FETCH_TIMEOUT, okExitCodes })

  try {
    await git(['fetch', '--depth', '1', 'origin', 'HEAD'])
  } catch (err) {
    if (err instanceof CommandError) {
      if (err.timedOut) throw new Error('La descarga de la actualización tardó más de 5 minutos y se canceló.')
      throw new Error('No se pudo descargar la actualización. Verifica que haya internet y que el repositorio siga existiendo y sea público.')
    }
    throw err
  }

  const current = (await git(['rev-parse', 'HEAD'])).trim()
  const latest = (await git(['rev-parse', 'FETCH_HEAD'])).trim()
  if (latest !== current) {
    await applyVersion(git, current, latest)
    if (!await findComposeFile(root)) {
      await git(['read-tree', '-m', '-u', latest, current])
      throw new Error('La última versión del repositorio ya no trae un archivo compose, así que el proyecto se dejó como estaba. Pide al equipo que lo agregue.')
    }
    await git(['reset', '--soft', latest])
  }

  const location = (await findComposeFile(root))!
  await copyEnvExample(location.dir)
  const [commit = '', summary = ''] = (await git(['log', '-1', '--format=%h%n%s', latest])).split('\n')
  return { dir: location.dir, changed: latest !== current, commit, summary: summary.slice(0, 120) }
}

/**
 * Cambia el código de un proyecto registrado desde un ZIP por el de un ZIP nuevo. El ZIP se abre y
 * se revisa en una carpeta aparte: si falla, el proyecto queda como estaba. Solo al final se cambia
 * la carpeta y se borra la anterior, con lo que el proyecto hubiera guardado en ella. Los volúmenes
 * de Docker no se tocan. No enciende ni reconstruye nada, y el proyecto debe estar apagado.
 */
export async function replaceProjectZip(name: string, filePath: string): Promise<ZipReplacement> {
  assertNormalizedName(name)
  const target = join(projectsDir(), name)
  const exists = await stat(target).then((info) => info.isDirectory(), () => false)
  if (!exists) throw new Error(`No se encontró la carpeta del proyecto en ${target}. Elimínalo y regístralo de nuevo.`)

  const staging = join(projectsDir(), '.reemplazos', name)
  const incoming = join(staging, 'nuevo')
  const previous = join(staging, 'anterior')
  await mkdir(staging, { recursive: true })
  await removeOrExplain(incoming)
  await removeOrExplain(previous)
  await mkdir(incoming)

  try {
    await extractZip(filePath, incoming)
    if (!await findComposeFile(incoming)) {
      throw new Error('El ZIP nuevo no trae un archivo compose en su raíz, así que el proyecto se dejó como estaba. Debe llamarse compose.yaml, compose.yml, docker-compose.yaml o docker-compose.yml.')
    }
  } catch (err) {
    await rm(incoming, { recursive: true, force: true })
    throw err
  }

  // Renombrar no depende de los permisos de lo que hay dentro, así que no falla a medias.
  await rename(target, previous)
  try {
    await rename(incoming, target)
  } catch (err) {
    await rename(previous, target)
    throw err
  }

  const location = (await findComposeFile(target))!
  await copyEnvExample(location.dir)

  let leftover: string | null = null
  try {
    await rm(previous, { recursive: true, force: true })
  } catch (err: any) {
    if (err.code !== 'EACCES' && err.code !== 'EPERM') throw err
    leftover = previous
  }
  return { dir: location.dir, leftover }
}

/** Borra una carpeta de un reemplazo anterior; si tiene archivos de root, dice cómo borrarla. */
async function removeOrExplain(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true })
  } catch (err: any) {
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      throw new Error(`Quedó la versión anterior de un reemplazo con archivos sin permiso de borrado. Ejecuta en una terminal: sudo rm -rf ${dir} y vuelve a intentarlo.`)
    }
    throw err
  }
}

type Git = (args: string[], okExitCodes?: number[]) => Promise<string>

/** Pasa la carpeta del proyecto de una versión a otra, o lanza un error sin haber cambiado nada. */
async function applyVersion(git: Git, from: string, to: string): Promise<void> {
  try {
    // Docker puede cambiar las fechas de los archivos; sin esto parecerían modificados. Sale con 1 si alguno lo está.
    await git(['update-index', '-q', '--refresh'], [1])
    await git(['read-tree', '-m', '-u', from, to])
  } catch (err) {
    if (!(err instanceof CommandError)) throw err
    if (/permission denied/i.test(err.stderr)) {
      throw new Error('El proyecto dejó archivos sin permiso de escritura. Elimínalo y regístralo de nuevo.')
    }
    const file = /'([^']+)'/.exec(err.stderr)?.[1]
    if (/not uptodate|would be overwritten|would be lost/i.test(err.stderr)) {
      throw new Error(`La actualización pisaría un archivo que cambió en esta PC${file ? ` (${file})` : ''}, así que no se aplicó. Puede pasar si el proyecto escribe en su propia carpeta. Para empezar limpio, elimínalo y regístralo de nuevo, aunque se borran sus datos.`)
    }
    throw new Error(`No se pudo aplicar la actualización: ${err.stderr.split('\n').slice(-3).join(' ')}`)
  }
}

async function extractZip(filePath: string, target: string): Promise<void> {
  const info = await stat(filePath).catch(() => null)
  if (!info?.isFile()) throw new Error(`No se encontró el archivo ZIP ${filePath}.`)

  await assertZipIsSafe(filePath)

  try {
    // unzip sale con 1 cuando hubo advertencias pero extrajo todo.
    await run('unzip', ['-q', filePath, '-d', target], { timeoutMs: FETCH_TIMEOUT, okExitCodes: [1] })
  } catch (err) {
    if (err instanceof CommandError) {
      if (err.timedOut) throw new Error('La descompresión del ZIP tardó más de 5 minutos y se canceló.')
      throw new Error('No se pudo descomprimir el archivo. Verifica que sea un ZIP válido y que no esté dañado.')
    }
    throw err
  }
}

/** Motivo para rechazar un ZIP según su contenido, o null si se puede abrir. */
export function zipProblem(names: string[], totalBytes: number): string | null {
  const unsafe = names.find((name) => {
    const path = name.replaceAll('\\', '/')
    return path.startsWith('/') || /^[a-zA-Z]:/.test(path) || path.split('/').includes('..')
  })
  if (unsafe !== undefined) {
    return `El ZIP se rechazó porque un archivo intenta salir de su carpeta: ${unsafe}. Pide al equipo que lo genere de nuevo.`
  }
  if (names.length > MAX_ZIP_ENTRIES) {
    return `El ZIP se rechazó porque tiene más de ${MAX_ZIP_ENTRIES} archivos. Pide al equipo que quite carpetas como node_modules.`
  }
  if (totalBytes > MAX_ZIP_BYTES) {
    return 'El ZIP se rechazó porque ocuparía más de 3 GB al descomprimirse. Pide al equipo que quite lo que no haga falta para encender.'
  }
  return null
}

/** Mira el contenido del ZIP sin extraerlo y lanza un error si no se debe abrir. */
async function assertZipIsSafe(filePath: string): Promise<void> {
  let names: string
  let totals: string
  try {
    // Sale con 1 cuando el ZIP está vacío; luego falla por no traer archivo compose.
    names = await run('unzip', ['-Z1', filePath], { timeoutMs: FETCH_TIMEOUT, okExitCodes: [1] })
    totals = await run('unzip', ['-Zt', filePath], { timeoutMs: FETCH_TIMEOUT, okExitCodes: [1] })
  } catch (err) {
    if (err instanceof CommandError) {
      throw new Error('No se pudo descomprimir el archivo. Verifica que sea un ZIP válido y que no esté dañado.')
    }
    throw err
  }
  const totalBytes = Number(/([\d,]+) bytes uncompressed/.exec(totals)?.[1]?.replaceAll(',', '') ?? 0)
  const problem = zipProblem(names.split('\n').filter(Boolean), totalBytes)
  if (problem) throw new Error(problem)
}

/** Si existe .env.example y no .env, lo copia: los valores de ejemplo suelen bastar para encender. */
async function copyEnvExample(dir: string): Promise<void> {
  const example = join(dir, '.env.example')
  try {
    await access(example)
  } catch {
    return
  }
  await copyFile(example, join(dir, '.env'), constants.COPYFILE_EXCL).catch((err) => {
    if (err.code !== 'EEXIST') throw err
  })
}
