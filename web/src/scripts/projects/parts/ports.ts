import { element } from '../element.ts'
import type { Project } from '../types.ts'

/** Un enlace por puerto publicado, o una raya si no hay. */
export function portLinks(project: Project): HTMLElement {
  const cell = element('span', 'font-mono text-xs text-slate-600')
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
