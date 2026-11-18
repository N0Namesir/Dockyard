import { element } from '../element.ts'
import { panelRow } from './panel-row.ts'
import { elapsedText } from '../format.ts'
import type { Progress, Project } from '../types.ts'

/** Rellena una fila de avance ya dibujada. Se usa también al consultar el avance cada 2 s. */
export function fillProgress(row: HTMLElement, progress: Progress | null): void {
  row.querySelector('[data-stage]')!.textContent = progress?.stage || 'Preparando el encendido'
  row.querySelector('[data-elapsed]')!.textContent = progress ? elapsedText(progress.elapsedSeconds) : ''
  const output = row.querySelector<HTMLElement>('pre')!
  output.textContent = progress?.lines.join('\n') ?? ''
  output.classList.toggle('hidden', !progress?.lines.length)
}

/** Avance del encendido: etapa, tiempo y últimas líneas de Docker. Lo usan la fila y la tarjeta. */
export function progressPanel(project: Project): HTMLElement {
  const panel = element('div')
  panel.dataset.progress = String(project.id)
  const header = element('div', 'flex flex-wrap items-center gap-x-3 gap-y-1 text-sm')
  const spinner = element('span', 'size-3.5 shrink-0 animate-spin rounded-full border-2 border-slate-300 border-t-marca-tinta motion-reduce:animate-none')
  spinner.setAttribute('aria-hidden', 'true')
  const stage = element('p', 'font-bold text-slate-800')
  stage.dataset.stage = ''
  stage.setAttribute('aria-live', 'polite')
  const elapsed = element('p', 'text-xs text-slate-600')
  elapsed.dataset.elapsed = ''
  header.append(spinner, stage, elapsed)
  const output = element('pre', 'mt-2 overflow-hidden whitespace-pre-wrap break-words rounded-lg bg-slate-900 p-3 font-mono text-xs text-slate-100')
  panel.append(header, output)
  fillProgress(panel, project.progress)
  return panel
}

export function progressRow(project: Project): HTMLTableRowElement {
  return panelRow(progressPanel(project), 'bg-slate-50 px-5 py-4')
}
