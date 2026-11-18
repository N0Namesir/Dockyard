// Estado de un proyecto para la fila y la tarjeta. La API lo decide; aquí solo se muestra.
import { element } from '../element.ts'
import { fillResources } from '../resources.ts'
import { isStarting } from '../state.ts'
import type { Project } from '../types.ts'

/** Estado del proyecto y lo que se sabe de él: fallas, si la web contesta y su consumo. */
export function projectStatus(project: Project): HTMLElement {
  // A medio encender, los contenedores que aún arrancan parecerían una falla.
  const starting = isStarting(project)
  const cell = element('div')
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
