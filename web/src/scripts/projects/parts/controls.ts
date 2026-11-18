// Botones de un proyecto, compartidos por la fila y la tarjeta. Las acciones llegan en RowHandlers.
import { element } from '../element.ts'
import { isStarting, state } from '../state.ts'
import type { Project, RowHandlers } from '../types.ts'
import { projectPageUrl } from './identity.ts'

/**
 * Encender o apagar, Abrir y el menú ⋯ con las demás acciones, más el error de la última acción y
 * la salida si otro proyecto ocupa su puerto. Lo usan la fila y la tarjeta.
 */
export function projectControls(project: Project, handlers: RowHandlers): HTMLElement {
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
  return stack
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
