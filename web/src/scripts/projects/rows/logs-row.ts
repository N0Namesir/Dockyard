import { element } from '../element.ts'
import { panelRow } from './panel-row.ts'
import { isStarting, state } from '../state.ts'
import type { Project } from '../types.ts'

export const EMPTY_LOGS = 'Este proyecto todavía no tiene registro.'

/** Últimas líneas del registro del proyecto. Lo usan la fila y la tarjeta. */
export function logsPanel(project: Project, loadLogs: (project: Project) => void): HTMLElement {
  const panel = element('div')
  panel.dataset.logs = String(project.id)
  const header = element('div', 'mb-2 flex items-center justify-between gap-3')
  const title = element('div')
  title.append(element('p', 'text-xs font-bold text-slate-700', `Últimas líneas del registro de ${project.name}`))
  const follows = project.state === 'running' || isStarting(project)
  const live = element('p', 'text-xs text-slate-600')
  live.dataset.live = ''
  title.append(live)
  header.append(title)
  const refresh = element('button', 'text-xs font-semibold text-slate-600 underline hover:text-marca-texto', 'Actualizar')
  refresh.type = 'button'
  refresh.addEventListener('click', () => loadLogs(project))
  if (!follows) header.append(refresh)
  const logs = state.openLogs.get(project.id)
  const output = element(
    'pre',
    'max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-900 p-3 font-mono text-xs text-slate-100',
    logs === null ? 'Cargando…' : logs?.trim() || EMPTY_LOGS,
  )
  const showLive = () => {
    live.textContent = !follows ? '' : state.logsScroll.has(project.id)
      ? 'En pausa mientras lees. Baja hasta el final para seguir.'
      : 'Se actualiza solo.'
  }
  showLive()
  output.addEventListener('scroll', () => {
    if (output.scrollHeight - output.scrollTop - output.clientHeight < 8) state.logsScroll.delete(project.id)
    else state.logsScroll.set(project.id, output.scrollTop)
    showLive()
  })
  panel.append(header, output)
  // Lo más reciente queda al final, salvo que el docente haya subido a leer.
  requestAnimationFrame(() => { output.scrollTop = state.logsScroll.get(project.id) ?? output.scrollHeight })
  return panel
}

export function logsRow(project: Project, loadLogs: (project: Project) => void): HTMLTableRowElement {
  return panelRow(logsPanel(project, loadLogs), 'bg-slate-50 px-5 py-4')
}
