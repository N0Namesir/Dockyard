// Imagen de un proyecto: la que subió el docente o, si no hay, la inicial de su nombre para mostrar
// sobre un color que sale del nombre técnico, así cada proyecto conserva siempre el suyo.
import { element } from './element.ts'
import type { Project } from './types.ts'

/** Combinaciones de los tokens de la marca con contraste suficiente para la inicial. */
const COLORS = [
  'bg-marca text-marca-tinta',
  'bg-marca-suave text-marca-texto',
  'bg-marca-tinta text-marca',
  'bg-marca-acento text-white',
  'bg-marca-secundario text-white',
  'bg-marca-fuerte text-marca-tinta',
]

export function displayNameOf(project: Pick<Project, 'name' | 'displayName'>): string {
  return project.displayName || project.name
}

function colorOf(name: string): string {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) >>> 0
  return COLORS[hash % COLORS.length]!
}

/** `classes` fija el tamaño y la forma; la imagen se recorta para llenarlo. */
export function avatar(project: Pick<Project, 'name' | 'displayName' | 'imageUrl'>, classes: string): HTMLElement {
  if (project.imageUrl) {
    const image = element('img', `${classes} object-cover`)
    image.src = project.imageUrl
    image.alt = ''
    image.loading = 'lazy'
    image.decoding = 'async'
    return image
  }
  const initial = [...displayNameOf(project).trim()][0]?.toLocaleUpperCase('es') ?? '?'
  const box = element('span', `${classes} ${colorOf(project.name)} flex items-center justify-center font-display font-extrabold select-none`, initial)
  box.setAttribute('aria-hidden', 'true')
  return box
}
