import type {
  PreparedProject,
  ProjectSource,
  ProjectStatus,
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
}

export interface ProjectResponse {
  id: number
  name: string
  team: string
  state: ProjectStatus['state']
  ports: number[]
  url: string | null
  urls: string[]
  failedServices: string[]
  /** null si está apagado o solo publica puertos que no son páginas. */
  web: WebCheck | null
  /** Lo que encontró la revisión al registrar. No impide encender. */
  warnings: string[]
}

export interface CoreAdapter {
  normalizeProjectName(name: string): string
  prepareProject(source: ProjectSource, name: string): Promise<PreparedProject>
  reviewProject(dir: string, name: string): Promise<string[]>
  startProject(dir: string, name: string): Promise<ProjectStatus>
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
