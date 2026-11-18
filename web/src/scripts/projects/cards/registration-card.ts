// Tarjeta de un proyecto que se está registrando, o que falló al registrarse, en la cuadrícula.
import { element } from '../element.ts'
import { registrationBadge, registrationDetail } from '../rows/registration-row.ts'
import type { Registration } from '../types.ts'

export function registrationCard(registration: Registration, dismiss: (registration: Registration) => void): HTMLElement {
  const failed = registration.error !== null
  const card = element('article', `col-span-12 flex min-w-0 flex-col gap-3 rounded-lg border p-4 sm:col-span-6 lg:col-span-4 xl:col-span-3 ${
    failed ? 'border-red-200 bg-red-50/60' : 'border-slate-200 bg-slate-50'
  }`)
  card.dataset.registration = registration.key
  card.setAttribute('aria-label', registration.name)
  const heading = element('div', 'min-w-0')
  heading.append(element('p', 'font-bold break-words text-slate-900', registration.name), element('p', 'text-sm text-slate-600', registration.team))
  const badge = element('div')
  badge.append(registrationBadge(registration))
  card.append(heading, badge, registrationDetail(registration, dismiss, 'start'))
  return card
}
