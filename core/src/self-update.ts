// Actualizar Dockyard desde su página. update.sh reconstruye y reemplaza el contenedor de Dockyard,
// así que no puede correr dentro de él: se cortaría a la mitad. Lo ejecuta un contenedor auxiliar
// con la misma imagen, la carpeta de instalación montada en la misma ruta, el mismo usuario y
// --network host (update.sh comprueba al final que Dockyard responda en localhost). El auxiliar no
// pertenece al proyecto de compose, así que sobrevive al reinicio de Dockyard.
import { hostname } from 'node:os'
import { docker } from './docker.ts'

const HELPER_NAME = 'dockyard-actualizacion'

/**
 * Lo que corre el auxiliar, siempre el mismo texto: la carpeta y el usuario van como argumentos de
 * docker, nunca dentro del script. Deja la salida y el código de salida en data/ de la instalación,
 * que la API lee como su propia carpeta de datos.
 */
const HELPER_SCRIPT = [
  'rm -f data/actualizacion.estado',
  './update.sh > data/actualizacion.log 2>&1',
  'echo $? > data/actualizacion.estado',
].join('\n')

export const SELF_UPDATE_LOG = 'actualizacion.log'
export const SELF_UPDATE_EXIT_CODE = 'actualizacion.estado'

const NOT_INSTALLED = 'La actualización desde la página solo funciona con Dockyard instalado con ./install.sh. Actualiza desde una terminal con ./update.sh.'

interface Installation {
  image: string
  dir: string
  user: string
  groups: string[]
}

/** Lee del contenedor de Dockyard su imagen, su carpeta de instalación, su usuario y sus grupos. */
async function currentInstallation(): Promise<Installation | null> {
  let output: string
  try {
    // Dentro de un contenedor, el nombre de la máquina es su id corto.
    output = await docker(['inspect', '--format', '{{json .}}', hostname()])
  } catch {
    return null
  }
  const info = JSON.parse(output) as {
    Image?: string
    Config?: { User?: string; Labels?: Record<string, string> }
    HostConfig?: { GroupAdd?: string[] | null }
  }
  const labels = info.Config?.Labels ?? {}
  const dir = labels['com.docker.compose.project.working_dir']
  if (labels['com.docker.compose.project'] !== 'dockyard' || !dir || !info.Image) return null
  return {
    image: info.Image,
    dir,
    user: info.Config?.User || '',
    groups: info.HostConfig?.GroupAdd ?? [],
  }
}

async function helperRunning(): Promise<boolean> {
  const ids = await docker(['ps', '-q', '--filter', `name=^${HELPER_NAME}$`])
  return ids.trim() !== ''
}

/** Si esta instalación se puede actualizar desde la página y si ya hay una actualización corriendo. */
export async function getSelfUpdateStatus(): Promise<{ supported: boolean; running: boolean }> {
  const installation = await currentInstallation()
  if (!installation) return { supported: false, running: false }
  return { supported: true, running: await helperRunning() }
}

/**
 * Lanza ./update.sh en un contenedor auxiliar y vuelve enseguida, sin esperar. Dockyard se reinicia
 * a la mitad; el avance y el resultado quedan en data/actualizacion.log y data/actualizacion.estado.
 */
export async function startSelfUpdate(): Promise<void> {
  const installation = await currentInstallation()
  if (!installation) throw new Error(NOT_INSTALLED)
  if (!installation.user || installation.user.split(':')[0] === '0') {
    throw new Error('Dockyard corre como root, y update.sh se niega a correr así. Actualiza desde una terminal con ./update.sh.')
  }
  if (await helperRunning()) throw new Error('Ya se está actualizando Dockyard. Espera a que termine.')

  const { image, dir, user, groups } = installation
  await docker([
    'run', '--detach', '--rm',
    '--name', HELPER_NAME,
    '--network', 'host',
    '--user', user,
    ...groups.flatMap((group) => ['--group-add', group]),
    '--env', 'HOME=/tmp',
    '--volume', '/var/run/docker.sock:/var/run/docker.sock',
    '--volume', `${dir}:${dir}`,
    '--workdir', dir,
    '--entrypoint', 'bash',
    image,
    '-c', HELPER_SCRIPT,
  ])
}
