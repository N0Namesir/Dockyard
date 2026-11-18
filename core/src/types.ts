// Tipos del contrato entre el núcleo (Área 1) y la API (Área 2).
// No cambian sin acuerdo entre los responsables de las dos áreas.

export type ProjectState = 'running' | 'stopped'

export interface ProjectStatus {
  state: ProjectState
  /** Puertos publicados en el anfitrión, sin repetidos y ordenados. */
  ports: number[]
  /** Servicios caídos o reiniciándose de un proyecto encendido. Solo aparece si hay alguno. */
  failedServices?: string[]
}

/** Avance de un encendido: una etapa para el docente y las últimas líneas de Docker. */
export interface StartProgress {
  stage: string
  lines: string[]
}

export interface ServiceResources {
  service: string
  /** Sobre toda la PC: 100 son todos sus núcleos. */
  cpuPercent: number
  memoryBytes: number
}

export interface ProjectResources {
  cpuPercent: number
  memoryBytes: number
  services: ServiceResources[]
}

export interface ResourceUsage {
  /** Memoria que Docker puede usar. 0 si no hay nada encendido. */
  memoryLimit: number
  /** Por nombre de proyecto de compose. Solo los encendidos. */
  projects: Record<string, ProjectResources>
}

/** Lo que ocupa en disco un proyecto de compose. */
export interface ProjectDiskUsage {
  /** Imágenes que construyó el proyecto y siguen en uso, o son su versión actual. */
  imageBytes: number
  /** Versiones viejas: imágenes del proyecto sin nombre que ningún contenedor usa. Se pueden liberar. */
  unusedImageBytes: number
  /** Volúmenes de Docker del proyecto: sus datos. */
  volumeBytes: number
}

export interface DiskUsage {
  /** Por nombre de proyecto de compose. Solo los que tienen imágenes construidas o volúmenes. */
  projects: Record<string, ProjectDiskUsage>
}

export interface ImagesPruned {
  /** Cuánto bajó lo que ocupan las imágenes de Docker. */
  freedBytes: number
  /** Imágenes borradas. */
  removed: number
}

/** Opciones de startProject. */
export interface StartOptions {
  onProgress?: (progress: StartProgress) => void
  /** Reconstruye las imágenes: hace falta después de actualizar el código. */
  build?: boolean
}

/** Avance de prepareProject: etapa en español y, al descargar un repositorio, el porcentaje. */
export interface PrepareProgress {
  stage: string
  percent: number | null
}

export interface PrepareOptions {
  onProgress?: (progress: PrepareProgress) => void
}

export interface ProjectUpdate {
  /** Carpeta que contiene el archivo compose, que pudo cambiar. */
  dir: string
  /** false si el proyecto ya estaba al día. */
  changed: boolean
  /** Versión actual: commit abreviado. */
  commit: string
  /** Título de esa versión, tal como lo escribió el equipo. */
  summary: string
}

export interface ZipReplacement {
  /** Carpeta que contiene el archivo compose del ZIP nuevo, que pudo cambiar. */
  dir: string
  /**
   * Carpeta de la versión anterior que no se pudo borrar porque el proyecto dejó archivos de
   * root, o null si se borró. No estorba, pero ocupa espacio hasta borrarla con sudo.
   */
  leftover: string | null
}

export type ProjectSource =
  | { type: 'git'; url: string }
  | { type: 'zip'; filePath: string }

export interface PreparedProject {
  /** Carpeta que contiene el archivo compose. Es la que se pasa a startProject y stopProject. */
  dir: string
  /** Nombre normalizado, válido para docker compose. */
  name: string
}

/**
 * Un puerto fijo del proyecto ya lo publica otro contenedor. `project` es su proyecto de compose,
 * o null si no es de compose: con él, la API puede ofrecer apagar ese proyecto y encender este.
 */
export class PortConflictError extends Error {
  override readonly name = 'PortConflictError'
  readonly port: number
  readonly container: string
  readonly project: string | null

  constructor(port: number, container: string, project: string | null) {
    super(`El puerto ${port} ya está en uso por el contenedor ${container}. Apaga ese proyecto o cambia el puerto en el compose.`)
    this.port = port
    this.container = container
    this.project = project
  }
}
