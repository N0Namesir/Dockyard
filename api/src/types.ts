import type {
  PreparedProject,
  ProjectSource,
  ProjectStatus,
  ProjectUpdate,
  StartOptions,
  StartProgress,
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
}

export interface UpdateResponse {
  project: ProjectResponse
  changed: boolean
  commit: string
  summary: string
}

export interface CoreAdapter {
  normalizeProjectName(name: string): string
  prepareProject(source: ProjectSource, name: string): Promise<PreparedProject>
  reviewProject(dir: string, name: string): Promise<string[]>
  updateProject(name: string): Promise<ProjectUpdate>
  startProject(dir: string, name: string, options?: StartOptions): Promise<ProjectStatus>
  stopProject(dir: string, name: string): Promise<ProjectStatus>
  getProjectStatus(name: string): Promise<ProjectStatus>
  getProjectLogs(name: string): Promise<string>
  removeProject(name: string): Promise<void>
}

export interface NewProjectRow {
  name: string
  team: string
  sourceType: ProjectRow['source_type']
  source: string
  dir: string
  warnings: string[]
}
