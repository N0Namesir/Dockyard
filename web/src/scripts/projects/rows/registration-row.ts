import { element } from '../element.ts'
import { elapsedText } from '../format.ts'
import type { Registration } from '../types.ts'

/** Rellena el avance de una fila ya dibujada: se consulta cada pocos segundos sin redibujar la tabla. */
export function fillRegistration(row: HTMLElement, registration: Registration): void {
  const percent = registration.percent
  row.querySelector('[data-stage]')!.textContent = percent === null ? registration.stage : `${registration.stage}: ${percent} %`
  row.querySelector('[data-elapsed]')!.textContent = elapsedText(registration.elapsedSeconds)
  const bar = row.querySelector<HTMLElement>('[data-bar]')!
  bar.parentElement!.classList.toggle('hidden', percent === null)
  bar.style.width = `${percent ?? 0}%`
}

export function registrationBadge(registration: Registration): HTMLElement {
  const failed = registration.error !== null
  return element(
    'span',
    `inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${failed ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-900'}`,
    failed ? 'No se registró' : 'Registrando',
  )
}

/**
 * Lo que está haciendo el registro, con su barra, o el motivo de la falla y Descartar. `align` es
 * hacia dónde se alinea: a la derecha en la tabla, a la izquierda en la tarjeta.
 */
export function registrationDetail(registration: Registration, dismiss: (registration: Registration) => void, align: 'start' | 'end'): HTMLElement {
  const end = align === 'end'
  if (registration.error !== null) {
    const stack = element('div', `flex flex-col gap-2 ${end ? 'items-end' : 'items-start'}`)
    stack.append(element('p', 'max-w-md whitespace-pre-wrap break-words text-left text-xs text-red-700', registration.error))
    const button = element('button', 'text-xs font-semibold text-slate-600 underline hover:text-marca-texto', 'Descartar')
    button.type = 'button'
    button.addEventListener('click', () => dismiss(registration))
    stack.append(button)
    return stack
  }
  const detail = element('div')
  const header = element('div', `flex flex-wrap items-center gap-x-3 gap-y-1 text-sm ${end ? 'justify-end' : ''}`)
  const spinner = element('span', 'size-3.5 shrink-0 animate-spin rounded-full border-2 border-slate-300 border-t-marca-tinta motion-reduce:animate-none')
  spinner.setAttribute('aria-hidden', 'true')
  const stage = element('p', 'font-bold text-slate-800')
  stage.dataset.stage = ''
  stage.setAttribute('aria-live', 'polite')
  const elapsed = element('p', 'text-xs text-slate-600')
  elapsed.dataset.elapsed = ''
  header.append(spinner, stage, elapsed)
  const track = element('div', `mt-2 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-slate-200 ${end ? 'ml-auto' : ''}`)
  const bar = element('div', 'h-full rounded-full bg-marca transition-[width] motion-reduce:transition-none')
  bar.dataset.bar = ''
  track.append(bar)
  detail.append(header, track)
  fillRegistration(detail, registration)
  return detail
}

/** Fila de un proyecto que se está registrando, o que falló al registrarse. */
export function registrationRow(registration: Registration, dismiss: (registration: Registration) => void): HTMLTableRowElement {
  const failed = registration.error !== null
  const row = element('tr', failed ? 'bg-red-50/60 text-slate-700' : 'bg-slate-50 text-slate-700')
  row.dataset.registration = registration.key
  const nameCell = element('td', 'px-5 py-4')
  nameCell.append(element('p', 'font-bold text-slate-900', registration.name))
  const status = element('td', 'px-5 py-4')
  status.append(registrationBadge(registration))
  const detail = element('td', 'px-5 py-4')
  detail.colSpan = 2
  detail.append(registrationDetail(registration, dismiss, 'end'))
  row.append(nameCell, element('td', 'px-5 py-4', registration.team), status, detail)
  return row
}
