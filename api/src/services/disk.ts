import type { ImagesPruned, ProjectDiskUsage } from '../core.ts'
import type { ProjectRepository } from '../db/projects.ts'
import { HttpError } from '../errors.ts'
import type { CoreAdapter, DiskResponse } from '../types.ts'

const EMPTY: ProjectDiskUsage = { imageBytes: 0, unusedImageBytes: 0, volumeBytes: 0 }

function bytesOf(usage: ProjectDiskUsage): number {
  return usage.imageBytes + usage.unusedImageBytes + usage.volumeBytes
}

/**
 * Espacio en disco de los proyectos registrados. Lo demás que haya en Docker no es asunto de
 * Dockyard: ni se muestra ni se borra.
 */
export function createDiskService(repository: ProjectRepository, core: CoreAdapter, busy: () => boolean) {
  // Una sola limpieza a la vez: una petición repetida espera el resultado de la que ya corre.
  let cleaning: Promise<ImagesPruned> | null = null

  return {
    async usage(): Promise<DiskResponse> {
      const rows = repository.list()
      const usage = rows.length > 0 ? await core.getDiskUsage() : { projects: {} }
      const total: ProjectDiskUsage = { ...EMPTY }
      const projects = rows.map((row) => {
        const project = usage.projects[row.name] ?? EMPTY
        total.imageBytes += project.imageBytes
        total.unusedImageBytes += project.unusedImageBytes
        total.volumeBytes += project.volumeBytes
        return { id: row.id, name: row.name, ...project }
      })
      // El que más ocupa primero: es el que conviene revisar.
      projects.sort((a, b) => bytesOf(b) - bytesOf(a))
      return { total, projects }
    },

    /** Borra las versiones viejas de las imágenes de los proyectos registrados. */
    clean(): Promise<ImagesPruned> {
      if (cleaning) return cleaning
      // Mientras algo enciende o se registra, Docker puede estar construyendo una imagen.
      if (busy()) {
        throw new HttpError(409, 'Hay proyectos encendiéndose, actualizándose o registrándose. Espera a que terminen para liberar espacio.')
      }
      const names = repository.list().map((row) => row.name)
      if (names.length === 0) return Promise.resolve({ freedBytes: 0, removed: 0 })
      cleaning = core.pruneProjectImages(names).finally(() => {
        cleaning = null
      })
      return cleaning
    },
  }
}

export type DiskService = ReturnType<typeof createDiskService>
