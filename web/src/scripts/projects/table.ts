// Dibuja la tabla completa a partir del estado. Las acciones de los botones llegan desde main.ts.
import { element, page } from './dom.ts'
import { logsRow } from './rows/logs-row.ts'
import { progressRow } from './rows/progress-row.ts'
import { registrationRow } from './rows/registration-row.ts'
import { projectRow } from './rows/project-row.ts'
import { warningsRow } from './rows/warnings-row.ts'
import { isStarting, state } from './state.ts'
import type { Registration, RowHandlers } from './types.ts'

let handlers: RowHandlers | undefined
let dismiss: ((registration: Registration) => void) | undefined

export function setRowHandlers(value: RowHandlers, dismissRegistration: (registration: Registration) => void): void {
  handlers = value
  dismiss = dismissRegistration
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
  // Se ofrece si hay algo encendido a la vista; la API apaga también lo que la búsqueda oculta.
  page.stopAll.hidden = loading || loadFailed || (!state.stoppingAll && !projects.some((project) => project.state === 'running'))
  page.stopAll.disabled = state.stoppingAll
  page.stopAll.textContent = state.stoppingAll ? 'Apagando todos…' : 'Apagar todos'
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
  // Los registros en curso van arriba y no dependen de la búsqueda: son pocos y duran poco.
  for (const registration of state.registrations) {
    page.projectsBody.append(registrationRow(registration, dismiss!))
  }
  if (projects.length === 0) {
    if (state.registrations.length > 0) return
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
