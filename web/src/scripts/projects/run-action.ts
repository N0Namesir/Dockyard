// Ayudante común de las acciones de una fila: marca qué está en curso, guarda el error y redibuja.
import { ApiResponseError, messageOf } from './api.ts'
import { state } from './state.ts'
import { render } from './table.ts'
import type { Project, ProjectAction } from './types.ts'

/** Marca la acción en curso, la ejecuta y siempre redibuja al terminar. Ignora un segundo clic. */
export async function runAction(project: Project, action: ProjectAction, work: () => Promise<void>, fallback: string): Promise<void> {
  if (state.pendingActions.has(project.id)) return
  state.pendingActions.set(project.id, action)
  state.actionErrors.delete(project.id)
  state.actionConflicts.delete(project.id)
  render()
  try {
    await work()
  } catch (error) {
    state.actionErrors.set(project.id, messageOf(error, fallback))
    if (action === 'start' && error instanceof ApiResponseError && error.body.conflict) {
      state.actionConflicts.set(project.id, error.body.conflict)
    }
    if (action === 'start' || action === 'stop') {
      // Una respuesta de error no trae el proyecto: sin esto seguiría figurando como encendiéndose.
      state.projects = state.projects.map((item) => item.id === project.id ? { ...item, progress: null } : item)
    }
  } finally {
    state.pendingActions.delete(project.id)
    render()
  }
}
