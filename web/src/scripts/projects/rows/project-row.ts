import { avatar } from '../avatar.ts'
import { element } from '../element.ts'
import { projectControls } from '../parts/controls.ts'
import { detailsLink, notesPreview, technicalName } from '../parts/identity.ts'
import { portLinks } from '../parts/ports.ts'
import { projectStatus } from '../parts/status.ts'
import type { Project, RowHandlers } from '../types.ts'

function cell(content: Node | string, classes = 'px-5 py-4'): HTMLTableCellElement {
  const node = element('td', classes)
  node.append(content)
  return node
}

/** Fila principal de un proyecto: nombre, equipo, estado, puertos y acciones. */
export function projectRow(project: Project, handlers: RowHandlers): HTMLTableRowElement {
  const row = element('tr', 'project-row text-slate-700 hover:bg-slate-50/70')
  const identity = element('div', 'flex items-start gap-3')
  const text = element('div', 'min-w-0')
  text.append(detailsLink(project, 'font-bold text-slate-900'))
  const technical = technicalName(project)
  if (technical) text.append(technical)
  const notes = notesPreview(project, 'max-w-48')
  if (notes) text.append(notes)
  identity.append(avatar(project, 'size-9 shrink-0 rounded-md text-lg'), text)
  row.append(
    cell(identity),
    cell(project.team, 'project-team px-5 py-4'),
    cell(projectStatus(project)),
    cell(portLinks(project)),
    cell(projectControls(project, handlers)),
  )
  return row
}
