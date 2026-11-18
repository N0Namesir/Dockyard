// Tarjeta de un proyecto en la vista de cuadrícula. Usa las mismas piezas que la fila de la tabla,
// así las acciones, los avisos y los errores se ven y funcionan igual.
import { avatar } from '../avatar.ts'
import { element } from '../element.ts'
import { projectControls } from '../parts/controls.ts'
import { detailsLink, notesPreview, projectPageUrl, technicalName } from '../parts/identity.ts'
import { portLinks } from '../parts/ports.ts'
import { projectStatus } from '../parts/status.ts'
import { logsPanel } from '../rows/logs-row.ts'
import { progressPanel } from '../rows/progress-row.ts'
import { warningsPanel } from '../rows/warnings-row.ts'
import { isStarting, state } from '../state.ts'
import type { Project, RowHandlers } from '../types.ts'

const CARD = 'project-card col-span-12 flex min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm sm:col-span-6 lg:col-span-4 xl:col-span-3'

export function projectCard(project: Project, handlers: RowHandlers): HTMLElement {
  const card = element('article', CARD)
  card.setAttribute('aria-label', project.displayName || project.name)
  // La imagen también lleva a la ficha, pero fuera del orden del teclado: el nombre ya es el enlace.
  const cover = element('a', 'block border-b border-slate-200')
  cover.href = projectPageUrl(project)
  cover.tabIndex = -1
  cover.setAttribute('aria-hidden', 'true')
  cover.append(avatar(project, 'aspect-video w-full text-6xl'))

  const body = element('div', 'flex flex-1 flex-col gap-3 p-4')
  const heading = element('div', 'min-w-0')
  heading.append(detailsLink(project, 'text-lg font-bold break-words text-slate-900'))
  heading.append(element('p', 'project-team text-sm text-slate-600', `${project.team} · ${project.year}`))
  const technical = technicalName(project)
  if (technical) heading.append(technical)
  const notes = notesPreview(project)
  if (notes) heading.append(notes)

  const status = element('div', 'flex flex-wrap items-start justify-between gap-2 text-sm')
  status.append(projectStatus(project))
  if (project.ports.length > 0) status.append(portLinks(project))

  const controls = element('div', 'project-card-controls mt-auto')
  controls.append(projectControls(project, handlers))
  body.append(heading, status, controls)
  card.append(cover, body)

  if (isStarting(project)) card.append(panel(progressPanel(project), 'border-t border-slate-200 bg-slate-50 p-4'))
  if (project.warnings.length > 0) card.append(panel(warningsPanel(project), 'border-t border-amber-200 bg-amber-50 p-4 text-sm text-amber-900'))
  if (state.openLogs.has(project.id)) card.append(panel(logsPanel(project, handlers.loadLogs), 'border-t border-slate-200 bg-slate-50 p-4'))
  return card
}

function panel(content: HTMLElement, classes: string): HTMLElement {
  const box = element('div', classes)
  box.append(content)
  return box
}
