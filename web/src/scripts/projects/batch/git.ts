// «Varios» desde GitHub: el docente pega una línea por proyecto, ve la vista previa con los errores
// y envía solo las válidas. La API las registra de a una, aunque se cierre la pestaña.
import { api, messageOf } from '../api.ts'
import { element } from '../element.ts'
import { loadRegistrations } from '../registrations.ts'
import { parseBatch, type BatchLine } from './parse.ts'

interface BatchResult {
  queued: string[]
  rejected: { index: number; name: string; message: string }[]
}

const form = document.querySelector<HTMLFormElement>('#batch-git')!
const lines = document.querySelector<HTMLTextAreaElement>('#batch-lines')!
const preview = document.querySelector<HTMLTableSectionElement>('#batch-preview')!
const status = document.querySelector<HTMLElement>('#batch-git-status')!
const submit = document.querySelector<HTMLButtonElement>('#batch-git-submit')!
const yearInput = document.querySelector<HTMLInputElement>('#batch-year')!

let taken = new Set<string>()
let parsed: BatchLine[] = []
let sending = false

function previewRow(item: BatchLine): HTMLTableRowElement {
  const row = element('tr', item.error ? 'bg-red-50/60' : '')
  row.append(
    element('td', 'text-slate-500', String(item.line)),
    element('td', '', item.team || '—'),
    element('td', 'font-mono', item.name ? item.normalized : '—'),
    element('td', item.error ? 'text-red-700' : 'text-emerald-800', item.error ?? 'Lista para registrar'),
  )
  return row
}

/** Con explain, también dice cuántas líneas tienen errores; tras enviar se deja el resultado. */
export function renderPreview(explain = true): void {
  parsed = parseBatch(lines.value, taken)
  preview.replaceChildren(...parsed.map(previewRow))
  const valid = parsed.filter((item) => !item.error).length
  const invalid = parsed.length - valid
  submit.disabled = sending || valid === 0
  submit.textContent = valid > 0 ? `Registrar ${valid} ${valid === 1 ? 'proyecto' : 'proyectos'}` : 'Registrar los proyectos válidos'
  if (explain && !sending) {
    status.textContent = parsed.length === 0 ? '' : invalid > 0
      ? `${invalid} ${invalid === 1 ? 'línea tiene' : 'líneas tienen'} errores y no se ${invalid === 1 ? 'envía' : 'envían'}. Corrígelas o déjalas para después.`
      : ''
  }
}

/** Nombres que ya existen o se están registrando, para avisarlo en la vista previa. */
export function setTakenNames(names: Set<string>): void {
  taken = names
  renderPreview()
}

async function send(): Promise<void> {
  const valid = parsed.filter((item) => !item.error)
  if (sending || valid.length === 0) return
  sending = true
  submit.disabled = true
  status.textContent = 'Enviando la lista…'
  try {
    const year = Number(yearInput.value) || new Date().getFullYear()
    const result = await api<BatchResult>('/api/projects/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year, items: valid.map(({ team, name, repoUrl }) => ({ team, name, repoUrl })) }),
    })
    // Quedan en el texto las líneas que no se enviaron o que la API rechazó, para corregirlas.
    const refused = new Set(result.rejected.map((item) => valid[item.index]!.line))
    const keep = parsed.filter((item) => item.error || refused.has(item.line)).map((item) => item.line)
    const text = lines.value.split(/\r?\n/)
    lines.value = keep.map((line) => text[line - 1]).join('\n')
    const parts = [`Se ${result.queued.length === 1 ? 'encoló 1 proyecto' : `encolaron ${result.queued.length} proyectos`}: se registran de a uno y su avance se ve arriba en la lista. Puedes cerrar el panel o la pestaña.`]
    for (const item of result.rejected) parts.push(`No se registró ${item.name}: ${item.message}`)
    status.textContent = parts.join(' ')
    for (const name of result.queued) taken.add(name)
    void loadRegistrations()
  } catch (error) {
    status.textContent = messageOf(error, 'No se pudo enviar la lista.')
  } finally {
    sending = false
    renderPreview(false)
  }
}

export function setupBatchGit(): void {
  lines.addEventListener('input', () => renderPreview())
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    void send()
  })
}
