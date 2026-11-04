import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/** Nombres de archivo compose aceptados, en el orden en que se buscan. */
export const COMPOSE_FILES = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml']

/**
 * Carpeta donde viven los proyectos registrados. Debe ser una ruta absoluta y, cuando la
 * herramienta corre en contenedor, la misma dentro y fuera de él (ver docker-compose.yml).
 */
export function projectsDir(): string {
  // src/ y dist/ están ambos a un nivel de core/, así que la raíz del repo queda dos niveles arriba.
  return resolve(process.env.PROJECTS_DIR || join(import.meta.dirname, '..', '..', 'projects'))
}

/**
 * Dónde se guarda el repositorio de un proyecto de GitHub. Va fuera de su carpeta porque los
 * contenedores suelen montarla: un hook o una configuración plantados en .git se ejecutarían al
 * actualizar, dentro de la herramienta que controla Docker.
 */
export function projectRepoDir(name: string): string {
  return join(projectsDir(), '.repos', name)
}

export interface ComposeLocation {
  /** Carpeta que contiene el archivo compose. */
  dir: string
  /** Ruta absoluta del archivo compose. */
  file: string
}

/**
 * Busca el archivo compose en la raíz y, si no está y la raíz tiene una sola carpeta
 * (típico de un ZIP armado desde una carpeta), dentro de esa carpeta.
 */
export async function findComposeFile(root: string): Promise<ComposeLocation | null> {
  const entries = await readdir(root, { withFileTypes: true })

  const inRoot = COMPOSE_FILES.find((name) => entries.some((e) => e.isFile() && e.name === name))
  if (inRoot) return { dir: root, file: join(root, inRoot) }

  // Se ignoran carpetas ocultas (.git) y la basura que agrega macOS al comprimir.
  const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== '__MACOSX')
  if (dirs.length !== 1) return null

  const sub = join(root, dirs[0]!.name)
  const subEntries = await readdir(sub, { withFileTypes: true })
  const inSub = COMPOSE_FILES.find((name) => subEntries.some((e) => e.isFile() && e.name === name))
  return inSub ? { dir: sub, file: join(sub, inSub) } : null
}
