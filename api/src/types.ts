import type {
  PreparedProject,
  ProjectSource,
  ProjectStatus,
} from './core.ts'

export interface ProjectRow {
  id: number
  name: string
  team: string
  source_type: 'git' | 'zip'
  source: string
  dir: string
  created_at: string
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
}

export interface CoreAdapter {
  normalizeProjectName(name: string): string
  prepareProject(source: ProjectSource, name: string): Promise<PreparedProject>
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
}
