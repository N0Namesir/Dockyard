// "Apagar todos": la API apaga los proyectos registrados que estén encendidos, también los que
// la búsqueda oculta y los de otras carpetas. Aquí solo se confirma, se marca lo que se está apagando y se resume.
import { messageOf, requestWithRetries } from './api.ts'
import { confirmAction } from './confirm-dialog.ts'
import { page, showGlobalMessage } from './dom.ts'
import { loadYears } from './folders.ts'
import { loadProjects } from './list.ts'
import { pollResources } from './resources.ts'
import { state } from './state.ts'
import { render } from './table.ts'
import type { StopAllResult } from './types.ts'

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many
}

/** Mensaje para el docente con lo que se apagó, lo que se saltó y lo que falló. */
export function summaryOf(result: StopAllResult): string {
  const { stopped, skipped, failed } = result
  const parts: string[] = []
  if (stopped.length > 0) {
    parts.push(`${plural(stopped.length, 'Se apagó', 'Se apagaron')} ${stopped.length} ${plural(stopped.length, 'proyecto', 'proyectos')}.`)
  } else if (skipped.length === 0 && failed.length === 0) {
    parts.push('No había proyectos encendidos.')
  }
  if (skipped.length > 0) {
    parts.push(`No se tocaron porque se están encendiendo, actualizando o eliminando: ${skipped.join(', ')}.`)
  }
  for (const { name, message } of failed) parts.push(`No se pudo apagar ${name}: ${message}`)
  return parts.join(' ')
}

export async function stopAll(): Promise<void> {
  if (state.stoppingAll) return
  const visible = state.projects.filter((project) => project.state === 'running')
  const searching = page.searchInput.value.trim() !== ''
  // Apaga todo, no solo la carpeta abierta: las carpetas dicen cuántos hay encendidos en cada año.
  const inFolder = state.folder !== 'todos'
  const total = inFolder ? state.years.reduce((sum, year) => sum + year.running, 0) : visible.length
  const hidden = [searching && 'los que la búsqueda no muestra', inFolder && 'los de otros años'].filter(Boolean).join(' y ')
  const confirmed = await confirmAction({
    title: searching || total === 0
      ? '¿Apagar todos los proyectos encendidos?'
      : `¿Apagar ${plural(total, 'el proyecto encendido', `los ${total} proyectos encendidos`)}?`,
    text: `Se apagan sin borrar nada: su código y sus datos se conservan, y cada uno se puede volver a encender.${
      hidden ? ` Incluye ${hidden}.` : ''}`,
    confirmLabel: 'Apagar todos',
  })
  if (!confirmed) return

  // Solo se marcan los que no tenían ya una acción en curso, para no pisarla al terminar.
  const marked = visible.filter((project) => !state.pendingActions.has(project.id))
  state.stoppingAll = true
  for (const project of marked) state.pendingActions.set(project.id, 'stop')
  render()
  try {
    const result = await requestWithRetries<StopAllResult>('/api/projects/stop-all', 'POST')
    const clean = result.skipped.length === 0 && result.failed.length === 0
    showGlobalMessage(summaryOf(result), clean ? 'success' : 'warning')
  } catch (error) {
    showGlobalMessage(messageOf(error, 'No se pudieron apagar los proyectos.'), 'error')
  } finally {
    state.stoppingAll = false
    for (const project of marked) state.pendingActions.delete(project.id)
    await Promise.all([loadProjects(true), loadYears()])
    render()
    // Sin esto, el consumo total seguiría mostrando lo de antes hasta el siguiente refresco.
    void pollResources()
  }
}
