// Acciones sobre un proyecto: encender o apagar, actualizar y eliminar. La API decide el
// resultado; aquí solo se marca qué está en curso y se muestra la respuesta.
import { ApiResponseError, messageOf, requestWithRetries } from './api.ts'
import { showGlobalMessage } from './dom.ts'
import { confirmRemoval } from './remove-dialog.ts'
import { replaceProject, state } from './state.ts'
import { render } from './table.ts'
import type { Project, ProjectAction, UpdateResult } from './types.ts'

/** Marca la acción en curso, la ejecuta y siempre redibuja al terminar. Ignora un segundo clic. */
async function runAction(project: Project, action: ProjectAction, work: () => Promise<void>, fallback: string): Promise<void> {
  if (state.pendingActions.has(project.id)) return
  state.pendingActions.set(project.id, action)
  state.actionErrors.delete(project.id)
  render()
  try {
    await work()
  } catch (error) {
    state.actionErrors.set(project.id, messageOf(error, fallback))
    if (action === 'start' || action === 'stop') {
      // Una respuesta de error no trae el proyecto: sin esto seguiría figurando como encendiéndose.
      state.projects = state.projects.map((item) => item.id === project.id ? { ...item, progress: null } : item)
    }
  } finally {
    state.pendingActions.delete(project.id)
    render()
  }
}

export async function changeState(project: Project): Promise<void> {
  const action = project.state === 'running' ? 'stop' : 'start'
  await runAction(project, action, async () => {
    replaceProject(await requestWithRetries<Project>(`/api/projects/${project.id}/${action}`, 'POST'))
  }, 'No se pudo cambiar el estado.')
}

export async function updateProject(project: Project): Promise<void> {
  await runAction(project, 'update', async () => {
    const { project: updated, changed, commit, summary } =
      await requestWithRetries<UpdateResult>(`/api/projects/${project.id}/update`, 'POST')
    replaceProject(updated)
    const total = updated.warnings.length
    if (!changed) showGlobalMessage(`${updated.name} ya estaba al día (${commit}: ${summary}).`, 'success')
    else if (total > 0) showGlobalMessage(`${updated.name} se actualizó a ${commit}: ${summary}. La versión nueva tiene ${total} ${total === 1 ? 'aviso' : 'avisos'}: revísalos antes de encender.`, 'warning')
    else showGlobalMessage(`${updated.name} se actualizó a ${commit}: ${summary}. Enciéndelo para ver los cambios.`, 'success')
  }, 'No se pudo actualizar.')
}

export async function removeProject(project: Project): Promise<void> {
  if (state.pendingActions.has(project.id)) return
  if (!(await confirmRemoval(project.name))) return
  await runAction(project, 'remove', async () => {
    // Borrar quita una red, y Firefox puede cortar la petición: un 404 tras el corte es que ya terminó.
    await requestWithRetries<true>(`/api/projects/${project.id}`, 'DELETE', (error) =>
      error instanceof ApiResponseError && error.status === 404 ? true : undefined,
    )
    state.projects = state.projects.filter((item) => item.id !== project.id)
    state.openLogs.delete(project.id)
    showGlobalMessage(`Se eliminó ${project.name}.`, 'success')
  }, 'No se pudo eliminar el proyecto.')
}
