// Dibuja la tabla completa a partir del estado. Las acciones de los botones llegan desde main.ts.
import { element, page } from './dom.ts'
import { logsRow } from './rows/logs-row.ts'
import { progressRow } from './rows/progress-row.ts'
import { projectRow } from './rows/project-row.ts'
import { warningsRow } from './rows/warnings-row.ts'
import { isStarting, state } from './state.ts'
import type { RowHandlers } from './types.ts'

let handlers: RowHandlers | undefined

export function setRowHandlers(value: RowHandlers): void {
  handlers = value
}

function messageRow(text: string): HTMLTableRowElement {
  const row = element('tr')
  const cell = element('td', 'px-5 py-12 text-center text-slate-500', text)
  cell.colSpan = 5
  row.append(cell)
  return row
}

export function render(): void {
  if (!handlers) throw new Error('Falta conectar las acciones de la tabla (setRowHandlers).')
  const { projects, loading, loadFailed } = state
  page.projectsBody.replaceChildren()
  page.projectCount.textContent = loading
    ? 'Cargando…'
    : loadFailed
      ? 'Sin datos'
      : `${projects.length} ${projects.length === 1 ? 'proyecto' : 'proyectos'}`

  if (loading) {
    page.projectsBody.append(messageRow('Cargando proyectos…'))
    return
  }
  if (loadFailed) {
    page.projectsBody.append(messageRow('No se pudo cargar la lista de proyectos.'))
    return
  }
  if (projects.length === 0) {
    page.projectsBody.append(messageRow(page.searchInput.value.trim()
      ? 'No se encontraron proyectos con esa búsqueda.'
      : 'Todavía no hay proyectos registrados.'))
    return
  }

  for (const project of projects) {
    page.projectsBody.append(projectRow(project, handlers))
    if (isStarting(project)) page.projectsBody.append(progressRow(project))
    if (project.warnings.length > 0) page.projectsBody.append(warningsRow(project))
    if (state.openLogs.has(project.id)) page.projectsBody.append(logsRow(project, handlers.loadLogs))
  }
}
