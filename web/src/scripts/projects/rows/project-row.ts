import { avatar, displayNameOf } from '../avatar.ts'
import { element } from '../dom.ts'
import { fillResources } from '../resources.ts'
import { isStarting, state } from '../state.ts'
import type { Project, RowHandlers } from '../types.ts'

/** Fila principal de un proyecto: nombre, equipo, estado, puertos y acciones. */
export function projectRow(project: Project, handlers: RowHandlers): HTMLTableRowElement {
  const row = element('tr', 'project-row text-slate-700 hover:bg-slate-50/70')
  const nameCell = element('td', 'px-5 py-4')
  const identity = element('div', 'flex items-start gap-3')
  const text = element('div', 'min-w-0')
  const link = element('a', 'font-bold text-slate-900 underline-offset-4 hover:text-marca-texto hover:underline', displayNameOf(project))
  link.href = projectPageUrl(project)
  link.dataset.action = 'details'
  text.append(link)
  if (project.displayName && project.displayName !== project.name) {
    text.append(element('p', 'font-mono text-xs break-all text-slate-500', project.name))
  }
  if (project.notes) {
    // Las notas largas se cortan a tres líneas; completas, al dejar el cursor encima o en la ficha.
    const notes = element('p', 'mt-1 line-clamp-3 max-w-48 whitespace-pre-wrap break-words text-xs text-slate-600', project.notes)
    notes.title = project.notes
    text.append(notes)
  }
  identity.append(avatar(project, 'size-9 shrink-0 rounded-md text-lg'), text)
  nameCell.append(identity)
  row.append(nameCell)
  row.append(element('td', 'project-team px-5 py-4', project.team))
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
        ? 'Web disponible'
        : web === 'error'
          ? `La web responde con error ${httpStatus}`
          : 'La web aún no responde',
      web === 'ok' ? 'text-emerald-800' : 'text-amber-800',
    )
  }
  if (project.state === 'running') {
    const usage = element('p', 'mt-1 max-w-40 text-sm text-slate-600')
    usage.dataset.resources = String(project.id)
    fillResources(usage, project.id)
    const details = element('details', 'project-diagnostics')
    details.dataset.disclosure = 'resources'
    const summary = element('summary', '', 'Recursos')
    summary.dataset.action = 'resources'
    details.append(summary, usage)
    cell.append(details)
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

  const actions = element('div', 'primary-actions')
  const toggle = element(
    'button',
    'ui-button',
    pending === 'stop'
      ? 'Apagando…'
      : starting
        ? 'Encendiendo…'
        : project.state === 'running' ? 'Apagar' : 'Encender',
  )
  toggle.type = 'button'
  toggle.dataset.action = 'toggle'
  toggle.disabled = isPending
  toggle.addEventListener('click', () => handlers.changeState(project))
  actions.append(toggle)

  if (!starting && project.state === 'running' && project.url) {
    const open = element(
      'a',
      'ui-button ui-button-primary',
      'Abrir',
    )
    open.dataset.action = 'open'
    open.setAttribute('aria-label', `Abrir ${project.name} en una pestaña nueva`)
    open.href = project.url
    open.target = '_blank'
    open.rel = 'noopener noreferrer'
    actions.append(open)
  }

  const secondary = element('div', 'project-menu-content')
  const isGit = project.sourceType === 'git'
  const source = element(
    'button',
    'text-slate-600 underline hover:text-marca-texto disabled:cursor-not-allowed disabled:no-underline disabled:opacity-50',
    isGit ? (pending === 'update' ? 'Actualizando…' : 'Actualizar') : (pending === 'replace' ? 'Reemplazando…' : 'Reemplazar ZIP'),
  )
  source.type = 'button'
  source.dataset.action = isGit ? 'update' : 'replace'
  source.disabled = isPending
  secondary.append(blockedWhileRunning(
    source,
    project,
    isGit ? 'Apaga el proyecto para actualizarlo.' : 'Apaga el proyecto para reemplazar su ZIP.',
    () => (isGit ? handlers.updateProject(project) : handlers.replaceZip(project)),
  ))
  // Editar lleva a la ficha, que es el único lugar donde se cambian sus datos.
  const edit = element('a', 'text-slate-600 underline hover:text-marca-texto', 'Editar ficha')
  edit.href = `${projectPageUrl(project)}#editar`
  edit.dataset.action = 'edit'
  secondary.append(edit)
  const logs = element(
    'button',
    'text-slate-600 underline hover:text-marca-texto',
    state.openLogs.has(project.id) ? 'Ocultar registro' : 'Ver registro',
  )
  logs.type = 'button'
  logs.dataset.action = 'logs'
  logs.setAttribute('aria-expanded', String(state.openLogs.has(project.id)))
  logs.addEventListener('click', () => handlers.toggleLogs(project))
  secondary.append(logs)

  // Lo que borra datos va aparte, al final del menú.
  const danger = element('div', 'menu-danger')
  const reset = element(
    'button',
    'text-red-700 underline hover:text-red-900 disabled:cursor-wait disabled:opacity-50',
    pending === 'reset' ? 'Reiniciando datos…' : 'Reiniciar datos',
  )
  reset.type = 'button'
  reset.dataset.action = 'reset'
  reset.disabled = isPending
  danger.append(blockedWhileRunning(reset, project, 'Apaga el proyecto para reiniciar sus datos.', () => handlers.resetData(project)))
  const remove = element(
    'button',
    'text-red-700 underline hover:text-red-900 disabled:cursor-wait disabled:opacity-50',
    pending === 'remove' ? 'Eliminando…' : 'Eliminar',
  )
  remove.type = 'button'
  remove.dataset.action = 'remove'
  remove.disabled = isPending
  remove.addEventListener('click', () => handlers.removeProject(project))
  danger.append(remove)
  secondary.append(danger)

  const stack = element('div', 'flex flex-col items-end gap-2')
  // El menú es un popover: flota sobre la tabla sin mover las demás acciones de la fila.
  const menuId = `project-menu-${project.id}`
  const trigger = element('button', 'ui-button project-menu-trigger')
  trigger.type = 'button'
  trigger.title = 'Más acciones'
  trigger.setAttribute('popovertarget', menuId)
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  icon.setAttribute('viewBox', '0 0 24 24')
  icon.setAttribute('width', '24')
  icon.setAttribute('height', '24')
  icon.setAttribute('fill', 'currentColor')
  icon.setAttribute('aria-hidden', 'true')
  for (const cx of [5, 12, 19]) {
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    dot.setAttribute('cx', String(cx))
    dot.setAttribute('cy', '12')
    dot.setAttribute('r', '2')
    icon.append(dot)
  }
  trigger.append(icon)
  trigger.dataset.action = 'menu'
  trigger.setAttribute('aria-label', `Más acciones de ${project.name}`)
  secondary.id = menuId
  secondary.popover = 'auto'
  secondary.dataset.disclosure = 'actions'
  const anchor = `--project-menu-${project.id}`
  trigger.style.setProperty('anchor-name', anchor)
  secondary.style.setProperty('position-anchor', anchor)
  secondary.addEventListener('toggle', (event) => {
    if ((event as ToggleEvent).newState === 'open') placeMenu(trigger, secondary)
  })
  // Cierra antes de ejecutar para que los diálogos recuperen un foco visible al terminar.
  secondary.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof HTMLButtonElement) || target.disabled || target.getAttribute('aria-disabled') === 'true') return
    secondary.hidePopover()
    trigger.focus()
  }, { capture: true })
  secondary.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { secondary.hidePopover(); trigger.focus(); event.stopPropagation() }
  })
  const controls = element('div', 'project-actions')
  controls.append(actions, trigger, secondary)
  stack.append(controls)
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

/** Página con la ficha del proyecto. */
export function projectPageUrl(project: Project): string {
  return `/proyecto/?id=${project.id}`
}

/**
 * Con el proyecto encendido, la acción queda bloqueada pero enfocable: el motivo aparece al pasar el
 * puntero, al enfocarla o al intentar usarla. Apagado, el botón ejecuta la acción.
 */
function blockedWhileRunning(button: HTMLButtonElement, project: Project, reason: string, run: () => void): HTMLElement {
  if (project.state !== 'running') {
    button.addEventListener('click', run)
    return button
  }
  button.setAttribute('aria-disabled', 'true')
  const hint = element('p', 'action-hint', reason)
  hint.id = `${button.dataset.action}-hint-${project.id}`
  button.setAttribute('aria-describedby', hint.id)
  button.addEventListener('click', () => hint.classList.add('action-hint-visible'))
  button.addEventListener('blur', () => hint.classList.remove('action-hint-visible'))
  const blocked = element('div', 'action-blocked')
  blocked.append(button, hint)
  return blocked
}

const anchorSupported = typeof CSS !== 'undefined' && CSS.supports('position-area: block-end')

/**
 * Sin anclaje en CSS (Firefox), coloca el menú bajo el botón, o encima si no cabe, dentro de la
 * ventana. Al desplazar la página se cierra, porque ya no seguiría al botón.
 */
function placeMenu(trigger: HTMLElement, menu: HTMLElement): void {
  if (anchorSupported) return
  const gap = 4
  const edge = 8
  const button = trigger.getBoundingClientRect()
  const box = menu.getBoundingClientRect()
  const below = button.bottom + gap
  const top = below + box.height <= innerHeight - edge ? below : Math.max(edge, button.top - gap - box.height)
  const left = Math.max(edge, Math.min(button.right - box.width, innerWidth - edge - box.width))
  menu.style.top = `${top}px`
  menu.style.left = `${left}px`
  addEventListener('scroll', () => menu.hidePopover(), { once: true, passive: true })
}
