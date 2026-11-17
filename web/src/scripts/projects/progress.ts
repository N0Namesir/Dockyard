// Avance de los encendidos en curso.
import { api } from './api.ts'
import { page } from './dom.ts'
import { loadProjects } from './list.ts'
import { fillProgress } from './rows/progress-row.ts'
import { isStarting, state } from './state.ts'
import type { Progress } from './types.ts'

let polling = false

/** Actualiza solo la fila del avance: redibujar la tabla cada 2 s perdería el foco y la selección. */
export async function pollProgress(): Promise<void> {
  const starting = state.projects.filter(isStarting)
  if (polling || document.hidden || starting.length === 0) return
  polling = true
  let finished = false
  try {
    await Promise.all(starting.map(async (project) => {
      const { progress } = await api<{ progress: Progress | null }>(`/api/projects/${project.id}/progress`)
      // Sin petición propia en curso (se recargó la página), nadie más avisaría que terminó.
      if (progress === null && !state.pendingActions.has(project.id)) finished = true
      project.progress = progress
      const row = page.projectsBody.querySelector<HTMLElement>(`[data-progress="${project.id}"]`)
      if (row) fillProgress(row, progress)
    }))
  } catch {
    // Se reintenta en la siguiente vuelta: un corte aquí no afecta al encendido.
  } finally {
    polling = false
  }
  if (finished) void loadProjects(true)
}
