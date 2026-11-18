import type {
  DiskUsage,
  ImagesPruned,
  PreparedProject,
  PrepareOptions,
  ProjectDiskUsage,
  ProjectSource,
  ProjectResources,
  ProjectStatus,
  ProjectUpdate,
  ResourceUsage,
  StartOptions,
  StartProgress,
  ZipReplacement,
} from './core.ts'
import type { WebCheck } from './services/web-check.ts'

export interface ProjectRow {
  id: number
  name: string
  team: string
  source_type: 'git' | 'zip'
  source: string
  dir: string
  created_at: string
  /** Lista de avisos de la revisión al registrar, como JSON. */
  warnings: string
  /** 1 si se actualizó el código y falta reconstruir sus imágenes. */
  needs_build: number
  /** 1 si el docente lo dejó encendido: al arrancar, Dockyard lo vuelve a encender si está apagado. */
  keep_running: number
  /** Texto libre del docente sobre el proyecto. */
  notes: string
}

export interface ProgressResponse extends StartProgress {
  elapsedSeconds: number
}

export interface ProjectResponse {
  id: number
  name: string
  team: string
  sourceType: ProjectRow['source_type']
  state: ProjectStatus['state']
  ports: number[]
  url: string | null
  urls: string[]
  failedServices: string[]
  /** null si está apagado o solo publica puertos que no son páginas. */
  web: WebCheck | null
  /** Lo que encontró la revisión al registrar. No impide encender. */
  warnings: string[]
  /** Avance del encendido en curso; null si no se está encendiendo. */
  progress: ProgressResponse | null
  /** Se actualizó el código: el próximo encendido reconstruye las imágenes. */
  pendingBuild: boolean
  /** Notas del docente; cadena vacía si no hay. */
  notes: string
}

export interface DiskResponse {
  /** Suma de los proyectos registrados. */
  total: ProjectDiskUsage
  /** Todos los registrados, el que más ocupa primero. */
  projects: ({ id: number; name: string } & ProjectDiskUsage)[]
}

export interface ResourcesResponse {
  memoryLimit: number
  /** Suma de los proyectos registrados. */
  total: { cpuPercent: number; memoryBytes: number }
  /** Por id de proyecto. Solo los registrados y encendidos. */
  projects: Record<number, ProjectResources>
}

/**
 * Un registro en curso, o uno que falló cuando ya nadie esperaba la respuesta (se cerró o recargó la
 * pestaña). Solo vive en memoria.
 */
export interface RegistrationResponse {
  key: string
  name: string
  team: string
  sourceType: 'git' | 'zip'
  stage: string
  /** Porcentaje de la descarga del repositorio; null en las demás etapas. */
  percent: number | null
  /** Motivo de la falla; null mientras sigue en curso. */
  error: string | null
  elapsedSeconds: number
}

/** Lo que se volvió a encender al arrancar Dockyard. */
export interface ResumeResult {
  started: string[]
  failed: { name: string; message: string }[]
}

export interface StopAllResponse {
  /** Nombres de los proyectos que se apagaron. */
  stopped: string[]
  /** Encendiéndose, actualizándose o eliminándose: no se tocaron. */
  skipped: string[]
  failed: { name: string; message: string }[]
}

export interface ReplaceResponse {
  project: ProjectResponse
  /** Carpeta de la versión anterior que quedó con archivos de root, o null. */
  leftover: string | null
}

export interface UpdateResponse {
  project: ProjectResponse
  changed: boolean
  commit: string
  summary: string
}

export interface CoreAdapter {
  normalizeProjectName(name: string): string
  prepareProject(source: ProjectSource, name: string, options?: PrepareOptions): Promise<PreparedProject>
  reviewProject(dir: string, name: string): Promise<string[]>
  updateProject(name: string): Promise<ProjectUpdate>
  replaceProjectZip(name: string, filePath: string): Promise<ZipReplacement>
  startProject(dir: string, name: string, options?: StartOptions): Promise<ProjectStatus>
  stopProject(dir: string, name: string): Promise<ProjectStatus>
  getProjectStatus(name: string): Promise<ProjectStatus>
  getProjectStatuses(): Promise<Record<string, ProjectStatus>>
  getProjectLogs(name: string): Promise<string>
  getResources(): Promise<ResourceUsage>
  getDiskUsage(): Promise<DiskUsage>
  pruneProjectImages(names: string[]): Promise<ImagesPruned>
  removeProject(name: string): Promise<void>
  renameProject(name: string, newName: string): Promise<PreparedProject>
  resetProjectData(dir: string, name: string): Promise<void>
  getSelfUpdateStatus(): Promise<{ supported: boolean; running: boolean }>
  startSelfUpdate(): Promise<void>
}

export interface NewProjectRow {
  name: string
  team: string
  sourceType: ProjectRow['source_type']
  source: string
  dir: string
  warnings: string[]
}
