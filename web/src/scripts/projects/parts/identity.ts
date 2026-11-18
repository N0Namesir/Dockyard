// Nombre de un proyecto con su imagen, compartido por la fila y la tarjeta.
import { avatar, displayNameOf } from '../avatar.ts'
import { element } from '../element.ts'
import type { Project } from '../types.ts'

/** Página con la ficha del proyecto. */
export function projectPageUrl(project: Project): string {
  return `/proyecto/?id=${project.id}`
}

/** Nombre técnico, en pequeño, si no es igual al que se muestra. */
export function technicalName(project: Project): HTMLElement | null {
  return project.displayName && project.displayName !== project.name
    ? element('p', 'font-mono text-xs break-all text-slate-500', project.name)
    : null
}

/** Enlace a la ficha con el nombre para mostrar. */
export function detailsLink(project: Project, classes: string): HTMLAnchorElement {
  const link = element('a', `${classes} underline-offset-4 hover:text-marca-texto hover:underline`, displayNameOf(project))
  link.href = projectPageUrl(project)
  link.dataset.action = 'details'
  return link
}

/** Notas del docente, cortadas a tres líneas; completas al dejar el cursor encima o en la ficha. */
export function notesPreview(project: Project, classes = ''): HTMLElement | null {
  if (!project.notes) return null
  const notes = element('p', `mt-1 line-clamp-3 whitespace-pre-wrap break-words text-xs text-slate-600 ${classes}`, project.notes)
  notes.title = project.notes
  return notes
}

