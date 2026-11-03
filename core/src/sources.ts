import { constants } from 'node:fs'
import { access, copyFile, mkdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { normalizeProjectName } from './name.ts'
import { findComposeFile, projectsDir } from './paths.ts'
import { CommandError, run } from './run.ts'
import type { PreparedProject, ProjectSource } from './types.ts'

const FETCH_TIMEOUT = 5 * 60_000

/**
 * Crea projects/<nombre>, obtiene el código desde un repositorio o un ZIP y devuelve la carpeta
 * que contiene el archivo compose. Si algo falla a mitad de camino, borra la carpeta que creó.
 */
export async function prepareProject(source: ProjectSource, name: string): Promise<PreparedProject> {
  const normalized = normalizeProjectName(name)
  validateSource(source)

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
    if (source.type === 'git') {
      await cloneRepo(source.url, target)
    } else {
      await extractZip(source.filePath, target)
    }

    const location = await findComposeFile(target)
    if (!location) {
      throw new Error('No se encontró un archivo compose en la raíz del proyecto. Debe llamarse compose.yaml, compose.yml, docker-compose.yaml o docker-compose.yml.')
    }

    await copyEnvExample(location.dir)
    return { dir: location.dir, name: normalized }
  } catch (err) {
    await rm(target, { recursive: true, force: true })
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
  } else if (source.type !== 'zip') {
    throw new Error('Fuente de proyecto desconocida: debe ser un repositorio git o un archivo ZIP.')
  }
}

async function cloneRepo(url: string, target: string): Promise<void> {
  try {
    // "--" evita que una URL que empiece con "-" se interprete como opción. Se conserva .git para poder hacer git pull.
    await run('git', ['clone', '--depth', '1', '--', url, target], { timeoutMs: FETCH_TIMEOUT })
  } catch (err) {
    if (err instanceof CommandError) {
      if (err.timedOut) throw new Error('El clonado del repositorio tardó más de 5 minutos y se canceló.')
      if (/could not read Username|terminal prompts disabled|Authentication failed|not found/i.test(err.stderr)) {
        throw new Error('No se pudo clonar el repositorio. Verifica que la URL sea correcta y que el repositorio sea público: los repositorios privados no se admiten en esta versión.')
      }
      throw new Error(`No se pudo clonar el repositorio: ${err.stderr.split('\n').slice(-3).join(' ')}`)
    }
    throw err
  }
}

async function extractZip(filePath: string, target: string): Promise<void> {
  const info = await stat(filePath).catch(() => null)
  if (!info?.isFile()) throw new Error(`No se encontró el archivo ZIP ${filePath}.`)

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
