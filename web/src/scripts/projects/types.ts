// Forma de las respuestas de la API (ver api/src/types.ts). La interfaz solo las muestra.

export interface Progress {
  stage: string
  lines: string[]
  elapsedSeconds: number
}

export interface Project {
  id: number
  name: string
  team: string
  state: 'running' | 'stopped'
  ports: number[]
  url: string | null
  urls: string[]
  failedServices: string[]
  web: { state: 'ok' | 'error' | 'no-response'; httpStatus?: number } | null
  warnings: string[]
  progress: Progress | null
  sourceType: 'git' | 'zip'
  pendingBuild: boolean
  /** Notas del docente; cadena vacía si no hay. */
  notes: string
}

/** Un registro en curso, o uno que falló sin una pestaña esperando la respuesta. */
export interface Registration {
  key: string
  name: string
  team: string
  sourceType: 'git' | 'zip'
  stage: string
  percent: number | null
  error: string | null
  elapsedSeconds: number
}

export interface ProjectResources {
  cpuPercent: number
  memoryBytes: number
  services: { service: string; cpuPercent: number; memoryBytes: number }[]
}

export interface Resources {
  memoryLimit: number
  total: { cpuPercent: number; memoryBytes: number }
  projects: Record<string, ProjectResources | undefined>
}

export interface VersionInfo {
  current: string
  latest: string | null
  updateAvailable: boolean
  /** Última consulta a GitHub que respondió; null si aún no hubo ninguna. */
  checkedAt: string | null
}

export interface UpdateResult {
  project: Project
  changed: boolean
  commit: string
  summary: string
}

export interface StopAllResult {
  stopped: string[]
  skipped: string[]
  failed: { name: string; message: string }[]
}

export interface ReplaceResult {
  project: Project
  /** Carpeta de la versión anterior que quedó con archivos de root, o null. */
  leftover: string | null
}

export type ProjectAction = 'start' | 'stop' | 'remove' | 'update' | 'replace' | 'edit' | 'reset'

/** Otro proyecto registrado que ocupa un puerto de este; la API lo manda al fallar el encendido. */
export interface PortConflict {
  id: number
  name: string
  port: number
}

/** Lo que pueden hacer los botones de una fila. Lo conecta main.ts, para que las filas no dependan de las acciones. */
export interface RowHandlers {
  changeState(project: Project): void
  updateProject(project: Project): void
  replaceZip(project: Project): void
  editProject(project: Project): void
  removeProject(project: Project): void
  /** Borra sus volúmenes de Docker y conserva el código y la ficha. */
  resetData(project: Project): void
  /** Apaga el proyecto que ocupa su puerto y lo enciende. */
  replaceConflicting(project: Project): void
  toggleLogs(project: Project): void
  loadLogs(project: Project): void
}
