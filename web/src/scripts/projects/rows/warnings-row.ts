import { element } from '../dom.ts'
import { state } from '../state.ts'
import type { Project } from '../types.ts'

/** Avisos de la revisión al registrar. La API los decide; aquí solo se muestran. */
export function warningsRow(project: Project): HTMLTableRowElement {
  const row = element('tr')
  const cell = element('td', 'bg-amber-50 px-5 py-3 text-sm text-amber-900')
  cell.colSpan = 5
  const details = element('details')
  details.dataset.disclosure = 'warnings'
  details.open = state.openWarnings.has(project.id)
  details.addEventListener('toggle', () => {
    if (details.open) state.openWarnings.add(project.id)
    else state.openWarnings.delete(project.id)
  })
  const total = project.warnings.length
  details.append(element(
    'summary',
    'cursor-pointer font-semibold',
    `Revisar antes de encender: ${total} ${total === 1 ? 'aviso' : 'avisos'}`,
  ))
  const list = element('ul', 'mt-2 list-disc space-y-1 pl-5 break-words')
  for (const warning of project.warnings) list.append(element('li', '', warning))
  details.append(list)
  cell.append(details)
  row.append(cell)
  return row
}
