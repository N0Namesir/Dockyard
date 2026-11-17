// Acciones sobre un proyecto: encender o apagar, apagar el que choca, actualizar y eliminar. La API decide el
// resultado; aquí solo se marca qué está en curso y se muestra la respuesta.
import { ApiResponseError, messageOf, requestWithRetries } from './api.ts'
import { confirmAction } from './confirm-dialog.ts'
import { showGlobalMessage } from './dom.ts'
import { confirmRemoval } from './remove-dialog.ts'
import { runAction } from './run-action.ts'
import { replaceProject, state } from './state.ts'
import { render } from './table.ts'
import type { Project, UpdateResult } from './types.ts'

export async function changeState(project: Project): Promise<void> {
  const action = project.state === 'running' ? 'stop' : 'start'
  await runAction(project, action, async () => {
    replaceProject(await requestWithRetries<Project>(`/api/projects/${project.id}/${action}`, 'POST'))
  }, 'No se pudo cambiar el estado.')
}

/**
 * Otro proyecto registrado ocupa un puerto de este: lo apaga, sin borrar nada, y enciende este.
 * Si aún choca con un tercero, la fila vuelve a ofrecer lo mismo con ese.
 */
export async function replaceConflicting(project: Project): Promise<void> {
  const conflict = state.actionConflicts.get(project.id)
  if (!conflict || state.pendingActions.has(project.id) || state.pendingActions.has(conflict.id)) return
  const confirmed = await confirmAction({
    title: `¿Apagar ${conflict.name} y encender ${project.name}?`,
    text: `${conflict.name} usa el puerto ${conflict.port}, que ${project.name} también necesita. Apagarlo no borra nada: se puede volver a encender cuando ${project.name} esté apagado.`,
    confirmLabel: 'Apagar y encender',
  })
  if (!confirmed) return
  await runAction(project, 'start', async () => {
    state.pendingActions.set(conflict.id, 'stop')
    state.actionErrors.delete(conflict.id)
    render()
    try {
      replaceProject(await requestWithRetries<Project>(`/api/projects/${conflict.id}/stop`, 'POST'))
    } catch (error) {
      throw new Error(`No se pudo apagar ${conflict.name}: ${messageOf(error, 'error desconocido.')}`)
    } finally {
      state.pendingActions.delete(conflict.id)
    }
    render()
    replaceProject(await requestWithRetries<Project>(`/api/projects/${project.id}/start`, 'POST'))
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
