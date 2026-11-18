// Dibuja la lista completa a partir del estado, en tabla o en cuadrícula. Las acciones de los
// botones llegan desde main.ts.
import { projectCard } from './cards/project-card.ts'
import { registrationCard } from './cards/registration-card.ts'
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
let searchEverywhere: (() => void) | undefined

export function setRowHandlers(
  value: RowHandlers,
  dismissRegistration: (registration: Registration) => void,
  searchAll: () => void,
): void {
  handlers = value
  dismiss = dismissRegistration
  searchEverywhere = searchAll
}

function messageRow(content: Node | string): HTMLTableRowElement {
  const row = element('tr')
  const cell = element('td', 'px-5 py-12 text-center text-slate-500')
  cell.append(content)
  cell.colSpan = 5
  row.append(cell)
  return row
}

const focusable = 'button, a, input, textarea, select, summary, [tabindex]'

export function render(): void {
  const active = document.activeElement as HTMLElement | null
  const rowKey = active?.closest<HTMLElement>('[data-row-key]')?.dataset.rowKey
  const action = active?.dataset.action
  const oldRow = active?.closest('[data-row-key]')
  const index = oldRow && active ? [...oldRow.querySelectorAll(focusable)].indexOf(active) : -1
  const disclosures = new Map<string, Map<string, boolean>>()
  for (const row of page.projectsArea.querySelectorAll<HTMLElement>('[data-row-key]')) {
    disclosures.set(row.dataset.rowKey!, new Map([...row.querySelectorAll<HTMLElement>('details, [popover]')].map(item => [item.dataset.disclosure ?? '', isOpen(item)])))
  }
  try { renderRows() } finally {
    for (const row of page.projectsArea.querySelectorAll<HTMLElement>('[data-row-key]')) {
      const previous = disclosures.get(row.dataset.rowKey!)
      if (previous) row.querySelectorAll<HTMLElement>('details, [popover]').forEach(item => {
        const open = previous.get(item.dataset.disclosure ?? '')
        if (open === undefined) return
        if (item instanceof HTMLDetailsElement) item.open = open
        else if (open) item.showPopover()
      })
    }
    if (rowKey && active && !active.isConnected) {
      const row = [...page.projectsArea.querySelectorAll<HTMLElement>('[data-row-key]')].find(item => item.dataset.rowKey === rowKey)
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

function messageCard(content: Node | string): HTMLElement {
  const box = element('div', 'col-span-12 py-12 text-center text-slate-500')
  box.append(content)
  return box
}

/** Sin resultados en la carpeta: el texto y, si se buscaba en un año, la salida para buscar en todos. */
function emptyMessage(): Node | string {
  const searching = page.searchInput.value.trim() !== ''
  const folder = state.folder
  if (!searching) {
    return folder === 'todos' ? 'Todavía no hay proyectos registrados.' : `No hay proyectos de ${folder}.`
  }
  if (folder === 'todos') return 'No se encontraron proyectos con esa búsqueda.'
  const box = element('div', 'flex flex-col items-center gap-3')
  box.append(element('p', '', `No se encontraron proyectos de ${folder} con esa búsqueda.`))
  const all = element('button', 'ui-button', 'Buscar en todos los años')
  all.type = 'button'
  all.dataset.action = 'search-all'
  all.addEventListener('click', () => searchEverywhere?.())
  box.append(all)
  return box
}

function renderRows(): void {
  if (!handlers) throw new Error('Falta conectar las acciones de la tabla (setRowHandlers).')
  const { projects, loading, loadFailed } = state
  const grid = state.view === 'grid'
  page.projectsTable.hidden = grid
  page.projectsGrid.hidden = !grid
  for (const button of page.viewButtons) button.setAttribute('aria-pressed', String(button.dataset.view === state.view))
  // Apaga todo, no solo la carpeta: se ofrece si algo está encendido a la vista o en otra carpeta.
  const running = projects.some((project) => project.state === 'running') || state.years.some((year) => year.running > 0)
  page.stopAll.hidden = loading || loadFailed || (!state.stoppingAll && !running)
  page.stopAll.disabled = state.stoppingAll
  page.stopAll.textContent = state.stoppingAll
    ? 'Apagando todos…'
    : state.folder === 'todos' ? 'Apagar todos' : 'Apagar todos (todos los años)'
  page.projectsTitle.textContent = state.folder === 'todos' ? 'Proyectos registrados' : `Proyectos de ${state.folder}`
  page.projectsBody.replaceChildren()
  page.projectsGrid.replaceChildren()
  page.projectCount.textContent = loading
    ? 'Cargando…'
    : loadFailed
      ? 'Sin datos'
      : `${projects.length} ${projects.length === 1 ? 'proyecto' : 'proyectos'}`

  const add = (node: HTMLElement, key: string) => {
    node.dataset.rowKey = key
    ;(grid ? page.projectsGrid : page.projectsBody).append(node)
  }
  const message = (content: Node | string) => grid
    ? page.projectsGrid.append(messageCard(content))
    : page.projectsBody.append(messageRow(content))

  if (loading) {
    message('Cargando proyectos…')
    return
  }
  if (loadFailed) {
    message('No se pudo cargar la lista de proyectos.')
    return
  }
  // Los registros en curso van arriba y no dependen de la búsqueda: son pocos y duran poco.
  for (const registration of state.registrations) {
    const key = `registration-${registration.key}`
    add(grid ? registrationCard(registration, dismiss!) : registrationRow(registration, dismiss!), key)
  }
  if (projects.length === 0) {
    if (state.registrations.length > 0) return
    message(emptyMessage())
    return
  }

  for (const project of projects) {
    if (grid) {
      add(projectCard(project, handlers), `project-${project.id}`)
      continue
    }
    add(projectRow(project, handlers), `project-${project.id}`)
    if (isStarting(project)) add(progressRow(project), `progress-${project.id}`)
    if (project.warnings.length > 0) add(warningsRow(project), `warnings-${project.id}`)
    if (state.openLogs.has(project.id)) add(logsRow(project, handlers.loadLogs), `logs-${project.id}`)
  }
}
