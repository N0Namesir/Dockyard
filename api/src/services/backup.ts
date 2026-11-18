// Exportar e importar la lista de proyectos, para pasar a otra PC o recuperarse tras reinstalar.
// Solo viaja la ficha: el código se vuelve a descargar de GitHub y los ZIP los vuelve a elegir el
// docente. Nunca se sobrescribe un proyecto que ya existe.
import type { ProjectRepository } from '../db/projects.ts'
import { HttpError } from '../errors.ts'
import type { Contact, ProjectResponse, ProjectRow } from '../types.ts'
import { imageTypeOf, type ImageStore } from './images.ts'
import type { ProjectService, RegisterProjectInput } from './projects.ts'

export const EXPORT_FORMAT = 1

export interface ExportedImage {
  type: 'png' | 'jpg' | 'webp'
  /** Los bytes del archivo en base64. */
  data: string
}

/** Un proyecto en el archivo exportado. */
export interface ExportedProject {
  name: string
  displayName?: string
  team: string
  year?: number
  sourceType: 'git' | 'zip'
  /** Solo en los de GitHub. */
  repoUrl?: string
  /** Solo en los de ZIP: el nombre del archivo que se subió, como referencia. */
  zipName?: string
  notes?: string
  description?: string
  instructions?: string
  contacts?: Contact[]
  image?: ExportedImage | null
}

export interface ExportFile {
  format: number
  dockyard: string
  exportedAt: string
  projects: ExportedProject[]
}

export type ImportAction = 'register' | 'needs-zip' | 'skip'

export interface ImportPlanItem {
  name: string
  displayName: string
  team: string
  year: number | null
  sourceType: 'git' | 'zip'
  action: ImportAction
  /** Por qué se omite. */
  reason: string | null
}

export interface ImportResult {
  queued: string[]
  needsZip: string[]
  skipped: { name: string; reason: string }[]
}

/** Lo que guarda la base de una ficha que espera su ZIP. */
export interface PendingImport {
  name: string
  displayName: string
  team: string
  year: number | null
  zipName: string | null
  hasImage: boolean
}

function imageBytes(image: ExportedImage | null | undefined): Uint8Array | undefined {
  if (!image) return undefined
  const bytes = Buffer.from(image.data, 'base64')
  // Una imagen que no es lo que dice no se importa; el resto de la ficha sí.
  return imageTypeOf(bytes) ? bytes : undefined
}

function inputOf(project: ExportedProject, name: string): Omit<RegisterProjectInput, 'source' | 'sourceLabel'> {
  return {
    team: project.team.trim(),
    name,
    displayName: project.displayName?.trim() || undefined,
    year: project.year,
    details: {
      notes: project.notes?.trim(),
      description: project.description?.trim(),
      instructions: project.instructions?.trim(),
      contacts: project.contacts,
    },
    image: imageBytes(project.image),
  }
}

export function createBackupService(
  repository: ProjectRepository,
  service: ProjectService,
  images: ImageStore,
  version: () => string,
) {
  async function exportImage(row: ProjectRow): Promise<ExportedImage | null> {
    if (!row.image) return null
    try {
      const { bytes } = await images.read(row.image)
      const type = imageTypeOf(bytes)
      return type ? { type, data: bytes.toString('base64') } : null
    } catch {
      return null
    }
  }

  /** Qué pasaría con cada proyecto del archivo: registrar, esperar su ZIP u omitirlo. */
  function plan(file: ExportFile): (ImportPlanItem & { project: ExportedProject })[] {
    const seen = new Set<string>()
    return file.projects.map((project) => {
      const name = service.normalizeName(project.name)
      const base = {
        project,
        name,
        displayName: project.displayName?.trim() || project.name,
        team: project.team,
        year: project.year ?? null,
        sourceType: project.sourceType,
      }
      let reason = service.nameUnavailable(name)
      if (!reason && repository.getPending(name) !== undefined) reason = 'Ya se importó y espera su ZIP.'
      if (!reason && seen.has(name)) reason = 'Se repite en el archivo.'
      if (!reason && project.sourceType === 'git' && !project.repoUrl) reason = 'Le falta la URL del repositorio.'
      seen.add(name)
      if (reason) return { ...base, action: 'skip', reason }
      return { ...base, action: project.sourceType === 'git' ? 'register' : 'needs-zip', reason: null }
    })
  }

  return {
    async exportList(): Promise<ExportFile> {
      const rows = repository.list().reverse()
      const projects: ExportedProject[] = []
      for (const row of rows) {
        projects.push({
          name: row.name,
          displayName: row.display_name,
          team: row.team,
          year: row.year,
          sourceType: row.source_type,
          ...(row.source_type === 'git' ? { repoUrl: row.source } : { zipName: row.source }),
          notes: row.notes,
          description: row.description,
          instructions: row.instructions,
          contacts: JSON.parse(row.contacts) as Contact[],
          image: await exportImage(row),
        })
      }
      return { format: EXPORT_FORMAT, dockyard: version(), exportedAt: new Date().toISOString(), projects }
    },

    preview(file: ExportFile): ImportPlanItem[] {
      return plan(file).map(({ project: _project, ...item }) => item)
    },

    /**
     * Los de GitHub van a la cola de registro con toda su ficha; los de ZIP quedan esperando su
     * archivo; los que ya existen se omiten. La URL se valida como al registrar uno.
     */
    apply(file: ExportFile, validateUrl: (url: string) => string): ImportResult {
      const result: ImportResult = { queued: [], needsZip: [], skipped: [] }
      const toQueue: RegisterProjectInput[] = []
      for (const item of plan(file)) {
        if (item.action === 'skip') {
          result.skipped.push({ name: item.name, reason: item.reason! })
          continue
        }
        if (item.action === 'needs-zip') {
          repository.savePending(item.name, JSON.stringify({ ...item.project, name: item.name }))
          result.needsZip.push(item.name)
          continue
        }
        try {
          const url = validateUrl(item.project.repoUrl!)
          toQueue.push({ ...inputOf(item.project, item.name), source: { type: 'git', url }, sourceLabel: url })
        } catch (error) {
          result.skipped.push({ name: item.name, reason: error instanceof Error ? error.message : 'URL no válida.' })
        }
      }
      const queued = service.enqueue(toQueue)
      result.queued = queued.queued
      for (const failure of queued.rejected) result.skipped.push({ name: failure.name, reason: failure.message })
      return result
    },

    pending(): PendingImport[] {
      return repository.listPending().map(({ name, data }) => {
        const project = JSON.parse(data) as ExportedProject
        return {
          name,
          displayName: project.displayName?.trim() || name,
          team: project.team,
          year: project.year ?? null,
          zipName: project.zipName ?? null,
          hasImage: Boolean(project.image),
        }
      })
    },

    /** Registra una ficha importada con el ZIP que eligió el docente, y deja de esperarlo. */
    async registerPending(name: string, zip: { filePath: string; sourceLabel: string; abandoned: () => boolean }): Promise<ProjectResponse> {
      const data = repository.getPending(name)
      if (data === undefined) throw new HttpError(404, 'Esa ficha importada ya no espera su ZIP.')
      const project = JSON.parse(data) as ExportedProject
      const created = await service.register({
        ...inputOf(project, name),
        source: { type: 'zip', filePath: zip.filePath },
        sourceLabel: zip.sourceLabel,
        abandoned: zip.abandoned,
      })
      repository.deletePending(name)
      return created
    },

    dismissPending(name: string): void {
      if (repository.getPending(name) === undefined) throw new HttpError(404, 'Esa ficha importada ya no espera su ZIP.')
      repository.deletePending(name)
    },
  }
}

export type BackupService = ReturnType<typeof createBackupService>
