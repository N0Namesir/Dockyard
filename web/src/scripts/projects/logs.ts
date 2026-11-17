// Registro (logs) de cada proyecto: abrir, cerrar y seguirlo mientras está encendido.
import { api, messageOf } from './api.ts'
import { isSelectingIn, page } from './dom.ts'
import { EMPTY_LOGS } from './rows/logs-row.ts'
import { isStarting, state } from './state.ts'
import { render } from './table.ts'
import type { Project } from './types.ts'

let polling = false

export async function loadLogs(project: Project): Promise<void> {
  state.openLogs.set(project.id, null)
  render()
  let text: string
  try {
    text = (await api<{ logs: string }>(`/api/projects/${project.id}/logs`)).logs
  } catch (error) {
    text = messageOf(error, 'No se pudo leer el registro.')
  }
  // Pudo cerrarse mientras se cargaba.
  if (state.openLogs.has(project.id)) {
    state.openLogs.set(project.id, text)
    render()
  }
}

export async function toggleLogs(project: Project): Promise<void> {
  if (state.openLogs.has(project.id)) {
    state.openLogs.delete(project.id)
    state.logsScroll.delete(project.id)
    render()
    return
  }
  await loadLogs(project)
}

/** Trae el registro de los proyectos encendidos con el registro abierto. No toca lo que el docente está leyendo. */
export async function pollLogs(): Promise<void> {
  const open = state.projects.filter((project) => typeof state.openLogs.get(project.id) === 'string'
    && (project.state === 'running' || isStarting(project)))
  if (polling || document.hidden || open.length === 0) return
  polling = true
  try {
    await Promise.all(open.map(async (project) => {
      const { logs } = await api<{ logs: string }>(`/api/projects/${project.id}/logs`)
      if (!state.openLogs.has(project.id) || state.openLogs.get(project.id) === logs) return
      state.openLogs.set(project.id, logs)
      const output = page.projectsBody.querySelector<HTMLElement>(`[data-logs="${project.id}"] pre`)
      if (!output || state.logsScroll.has(project.id) || isSelectingIn(output)) return
      output.textContent = logs.trim() || EMPTY_LOGS
      output.scrollTop = output.scrollHeight
    }))
  } catch {
    // Se reintenta en la siguiente vuelta; el registro en pantalla sigue siendo válido.
  } finally {
    polling = false
  }
}
