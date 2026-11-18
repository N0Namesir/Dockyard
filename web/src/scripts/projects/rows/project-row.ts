import { element } from '../dom.ts'
import { fillResources } from '../resources.ts'
import { isStarting, state } from '../state.ts'
import type { Project, RowHandlers } from '../types.ts'

/** Fila principal de un proyecto: nombre, equipo, estado, puertos y acciones. */
export function projectRow(project: Project, handlers: RowHandlers): HTMLTableRowElement {
  const row = element('tr', 'text-slate-700 hover:bg-slate-50/70')
  const nameCell = element('td', 'px-5 py-4')
  nameCell.append(element('p', 'font-bold text-slate-900', project.name))
  if (project.notes) {
    // Las notas largas se cortan a tres líneas; completas, al dejar el cursor encima o en Editar.
    const notes = element('p', 'mt-1 line-clamp-3 max-w-48 whitespace-pre-wrap break-words text-xs text-slate-600', project.notes)
    notes.title = project.notes
    nameCell.append(notes)
  }
  row.append(nameCell)
  row.append(element('td', 'px-5 py-4', project.team))
  row.append(stateCell(project), portsCell(project), actionsCell(project, handlers))
  return row
}

function stateCell(project: Project): HTMLTableCellElement {
  // A medio encender, los contenedores que aún arrancan parecerían una falla.
  const starting = isStarting(project)
  const cell = element('td', 'px-5 py-4')
  cell.append(
    element(
      'span',
      `inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${
        starting
          ? 'bg-amber-100 text-amber-900'
          : project.state === 'running'
            ? 'bg-emerald-100 text-emerald-800'
            : 'bg-slate-200 text-slate-700'
      }`,
      starting ? 'Encendiendo' : project.state === 'running' ? 'Encendido' : 'Apagado',
    ),
  )
  if (starting) return cell

  const note = (text: string, color = 'text-amber-800') =>
    cell.append(element('p', `mt-1 max-w-40 text-xs font-medium ${color}`, text))

  if (project.pendingBuild) note('Actualizado: se reconstruye al encender')
  if (project.failedServices.length > 0) note(`Con fallas: ${project.failedServices.join(', ')}`)
  if (project.web) {
    const { state: web, httpStatus } = project.web
    note(
      web === 'ok'
        ? 'La web responde'
        : web === 'error'
          ? `La web responde con error ${httpStatus}`
          : 'La web aún no responde',
      web === 'ok' ? 'text-emerald-800' : 'text-amber-800',
    )
  }
  if (project.state === 'running') {
    const usage = element('p', 'mt-1 max-w-40 text-xs text-slate-600')
    usage.dataset.resources = String(project.id)
    fillResources(usage, project.id)
    cell.append(usage)
  }
  return cell
}

function portsCell(project: Project): HTMLTableCellElement {
  const cell = element('td', 'px-5 py-4 font-mono text-xs text-slate-600')
  if (project.ports.length === 0) cell.textContent = '—'
  project.ports.forEach((port, index) => {
    if (index > 0) cell.append(', ')
    const link = element('a', 'text-marca-texto underline hover:text-marca-tinta', String(port))
    link.href = project.urls[index] ?? '#'
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    cell.append(link)
  })
  return cell
}

function actionsCell(project: Project, handlers: RowHandlers): HTMLTableCellElement {
  const starting = isStarting(project)
  const pending = state.pendingActions.get(project.id)
  const isPending = pending !== undefined || starting

  const actions = element('div', 'flex items-center justify-end gap-2')
  const toggle = element(
    'button',
    'rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:border-marca-tinta hover:text-marca-texto disabled:cursor-wait disabled:opacity-50',
    pending === 'stop'
      ? 'Apagando…'
      : starting
        ? 'Encendiendo…'
        : project.state === 'running' ? 'Apagar' : 'Encender',
  )
  toggle.type = 'button'
  toggle.disabled = isPending
  toggle.addEventListener('click', () => handlers.changeState(project))
  actions.append(toggle)

  if (!starting && project.state === 'running' && project.url) {
    const open = element(
      'a',
      'rounded-lg bg-marca px-3 py-1.5 text-xs font-bold text-marca-tinta hover:bg-marca-fuerte',
      'Abrir',
    )
    open.href = project.url
    open.target = '_blank'
    open.rel = 'noopener noreferrer'
    actions.append(open)
  }

  const secondary = element('div', 'flex items-center justify-end gap-3 whitespace-nowrap text-xs font-semibold')
  if (project.sourceType === 'git') {
    const update = element(
      'button',
      'text-slate-600 underline hover:text-marca-texto disabled:cursor-not-allowed disabled:no-underline disabled:opacity-50',
      pending === 'update' ? 'Actualizando…' : 'Actualizar',
    )
    update.type = 'button'
    update.disabled = isPending || project.state === 'running'
    if (project.state === 'running') update.title = 'Apaga el proyecto para actualizarlo'
    update.addEventListener('click', () => handlers.updateProject(project))
    secondary.append(update)
  } else {
    const replace = element(
      'button',
      'text-slate-600 underline hover:text-marca-texto disabled:cursor-not-allowed disabled:no-underline disabled:opacity-50',
      pending === 'replace' ? 'Reemplazando…' : 'Reemplazar ZIP',
    )
    replace.type = 'button'
    replace.disabled = isPending || project.state === 'running'
    if (project.state === 'running') replace.title = 'Apaga el proyecto para reemplazar su ZIP'
    replace.addEventListener('click', () => handlers.replaceZip(project))
    secondary.append(replace)
  }
  const edit = element(
    'button',
    'text-slate-600 underline hover:text-marca-texto disabled:cursor-wait disabled:no-underline disabled:opacity-50',
    pending === 'edit' ? 'Guardando…' : 'Editar',
  )
  edit.type = 'button'
  edit.disabled = isPending
  edit.addEventListener('click', () => handlers.editProject(project))
  secondary.append(edit)
  const logs = element(
    'button',
    'text-slate-600 underline hover:text-marca-texto',
    state.openLogs.has(project.id) ? 'Ocultar registro' : 'Ver registro',
  )
  logs.type = 'button'
  logs.addEventListener('click', () => handlers.toggleLogs(project))
  const remove = element(
    'button',
    'text-red-700 underline hover:text-red-900 disabled:cursor-wait disabled:opacity-50',
    pending === 'remove' ? 'Eliminando…' : 'Eliminar',
  )
  remove.type = 'button'
  remove.disabled = isPending
  remove.addEventListener('click', () => handlers.removeProject(project))
  secondary.append(logs, remove)

  const stack = element('div', 'flex flex-col items-end gap-2')
  stack.append(actions, secondary)
  const error = state.actionErrors.get(project.id)
  if (error) {
    stack.append(element('p', 'max-w-md whitespace-pre-wrap break-words text-left text-xs text-red-700', error))
  }
  const conflict = state.actionConflicts.get(project.id)
  if (conflict && !isPending && project.state !== 'running') {
    const replace = element(
      'button',
      'rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:border-marca-tinta hover:text-marca-texto',
      `Apagar ${conflict.name} y encender este`,
    )
    replace.type = 'button'
    replace.addEventListener('click', () => handlers.replaceConflicting(project))
    stack.append(replace)
  }
  const cell = element('td', 'px-5 py-4')
  cell.append(stack)
  return cell
}
