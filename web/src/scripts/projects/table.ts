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

const focusable = 'button, a, input, textarea, select, summary, [tabindex]'

export function render(): void {
  const active = document.activeElement as HTMLElement | null
  const rowKey = active?.closest<HTMLElement>('[data-row-key]')?.dataset.rowKey
  const action = active?.dataset.action
  const oldRow = active?.closest('tr')
  const index = oldRow && active ? [...oldRow.querySelectorAll(focusable)].indexOf(active) : -1
  const disclosures = new Map<string, Map<string, boolean>>()
  for (const row of page.projectsBody.querySelectorAll<HTMLElement>('[data-row-key]')) {
    disclosures.set(row.dataset.rowKey!, new Map([...row.querySelectorAll<HTMLElement>('details, [popover]')].map(item => [item.dataset.disclosure ?? '', isOpen(item)])))
  }
  try { renderRows() } finally {
    for (const row of page.projectsBody.querySelectorAll<HTMLElement>('[data-row-key]')) {
      const previous = disclosures.get(row.dataset.rowKey!)
      if (previous) row.querySelectorAll<HTMLElement>('details, [popover]').forEach(item => {
        const open = previous.get(item.dataset.disclosure ?? '')
        if (open === undefined) return
        if (item instanceof HTMLDetailsElement) item.open = open
        else if (open) item.showPopover()
      })
    }
    if (rowKey && active && !active.isConnected) {
      const row = [...page.projectsBody.querySelectorAll<HTMLElement>('[data-row-key]')].find(item => item.dataset.rowKey === rowKey)
      let target = action ? row?.querySelector<HTMLElement>(`[data-action="${action}"]`) : row?.querySelectorAll<HTMLElement>(focusable)[index]
      if (target && !target.checkVisibility()) target = row?.querySelector<HTMLElement>('[data-action="menu"]')
      if (target?.matches(':disabled')) target = row?.querySelector<HTMLElement>('[data-action="menu"]')
      const fallback = row?.querySelector<HTMLElement>('[data-action="menu"]') ?? page.searchInput
      ;(target ?? fallback).focus({ preventScroll: true })
    }
  }
}

/** Un desplegable de la fila (`details`) o su menú de acciones (popover) está abierto. */
function isOpen(item: HTMLElement): boolean {
  return item instanceof HTMLDetailsElement ? item.open : item.matches(':popover-open')
}

function appendRow(row: HTMLTableRowElement, key: string): void {
  row.dataset.rowKey = key
  page.projectsBody.append(row)
}

function renderRows(): void {
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
    appendRow(registrationRow(registration, dismiss!), `registration-${registration.key}`)
  }
  if (projects.length === 0) {
    if (state.registrations.length > 0) return
    page.projectsBody.append(messageRow(page.searchInput.value.trim()
      ? 'No se encontraron proyectos con esa búsqueda.'
      : 'Todavía no hay proyectos registrados.'))
    return
  }

  for (const project of projects) {
    appendRow(projectRow(project, handlers), `project-${project.id}`)
    if (isStarting(project)) appendRow(progressRow(project), `progress-${project.id}`)
    if (project.warnings.length > 0) appendRow(warningsRow(project), `warnings-${project.id}`)
    if (state.openLogs.has(project.id)) appendRow(logsRow(project, handlers.loadLogs), `logs-${project.id}`)
  }
}
