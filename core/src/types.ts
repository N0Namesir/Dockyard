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

/** Opciones de startProject. */
export interface StartOptions {
  onProgress?: (progress: StartProgress) => void
  /** Reconstruye las imágenes: hace falta después de actualizar el código. */
  build?: boolean
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

export type ProjectSource =
  | { type: 'git'; url: string }
  | { type: 'zip'; filePath: string }

export interface PreparedProject {
  /** Carpeta que contiene el archivo compose. Es la que se pasa a startProject y stopProject. */
  dir: string
  /** Nombre normalizado, válido para docker compose. */
  name: string
}
