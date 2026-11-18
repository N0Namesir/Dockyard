// Dibuja la ficha a partir de lo que respondió la API. No decide estados: solo los muestra.
import { avatar, displayNameOf } from '../projects/avatar.ts'
import { element } from '../projects/element.ts'
import { bytesText, cpuText } from '../projects/format.ts'
import type { Project, ProjectResources } from '../projects/types.ts'
import { view } from './dom.ts'

function textOrEmpty(target: HTMLElement, text: string, empty: string): void {
  target.textContent = text || empty
  target.classList.toggle('text-slate-500', !text)
  target.classList.toggle('italic', !text)
}

function contactItem(contact: Project['contacts'][number]): HTMLLIElement {
  const item = element('li', 'col-span-12 rounded-md border border-slate-200 bg-white p-3 text-sm sm:col-span-6')
  item.append(element('p', 'font-semibold break-words text-slate-900', contact.name))
  if (contact.email) {
    const mail = element('a', 'block break-all text-marca-texto underline hover:text-marca-tinta', contact.email)
    mail.href = `mailto:${contact.email}`
    item.append(mail)
  }
  if (contact.phone) {
    const phone = element('a', 'block text-slate-700 underline hover:text-marca-texto', contact.phone)
    phone.href = `tel:${contact.phone.replace(/[^\d+]/g, '')}`
    item.append(phone)
  }
  return item
}

export interface ViewState {
  /** Acción en curso desde esta página. */
  pending: 'start' | 'stop' | null
  resources: ProjectResources | null
}

export function renderView(project: Project, state: ViewState): void {
  const name = displayNameOf(project)
  document.title = `Dockyard · ${name}`
  view.root.hidden = false
  view.loading.hidden = true
  view.image.replaceChildren(avatar(project, 'aspect-square w-full text-8xl'))
  view.displayName.textContent = name
  view.name.textContent = project.name
  view.team.textContent = project.team
  view.year.textContent = String(project.year)

  const starting = state.pending === 'start' || project.progress !== null
  const running = project.state === 'running'
  view.state.textContent = starting ? 'Encendiendo' : running ? 'Encendido' : 'Apagado'
  view.state.className = `inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${
    starting ? 'bg-amber-100 text-amber-900' : running ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
  }`
  view.toggle.textContent = state.pending === 'stop' ? 'Apagando…' : starting ? 'Encendiendo…' : running ? 'Apagar' : 'Encender'
  view.toggle.disabled = state.pending !== null || starting
  view.open.hidden = !(running && !starting && project.url)
  if (project.url) view.open.href = project.url
  view.open.setAttribute('aria-label', `Abrir ${name} en una pestaña nueva`)
  const usage = running ? state.resources : null
  view.resources.textContent = usage ? `Consumo: CPU ${cpuText(usage.cpuPercent)}, memoria ${bytesText(usage.memoryBytes)}.` : ''
  view.resources.hidden = !usage

  textOrEmpty(view.description, project.description, 'El equipo aún no tiene una descripción.')
  textOrEmpty(view.instructions, project.instructions, 'Sin indicaciones.')
  textOrEmpty(view.notes, project.notes, 'Sin notas.')
  view.contacts.replaceChildren(...project.contacts.map(contactItem))
  if (project.contacts.length === 0) {
    view.contacts.append(element('li', 'col-span-12 text-sm text-slate-500 italic', 'Sin contactos.'))
  }
  view.warningsBox.hidden = project.warnings.length === 0
  view.warnings.replaceChildren(...project.warnings.map((warning) => element('li', 'break-words', warning)))
}
