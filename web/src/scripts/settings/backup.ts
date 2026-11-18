// Sección "Respaldo" de Configuración: exportar e importar la lista de proyectos. La API decide qué
// se registra, qué espera su ZIP y qué se omite; aquí se muestra antes de aplicar.
import { api, messageOf } from '../projects/api.ts'
import { confirmAction } from '../projects/confirm-dialog.ts'
import { element } from '../projects/element.ts'

interface PlanItem {
  name: string
  displayName: string
  team: string
  year: number | null
  sourceType: 'git' | 'zip'
  action: 'register' | 'needs-zip' | 'skip'
  reason: string | null
}

interface ImportResult {
  queued: string[]
  needsZip: string[]
  skipped: { name: string; reason: string }[]
}

interface Pending {
  name: string
  displayName: string
  team: string
  year: number | null
  zipName: string | null
}

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!
const fileInput = $<HTMLInputElement>('#import-file')
const previewBox = $('#import-preview-box')
const preview = $<HTMLTableSectionElement>('#import-preview')
const apply = $<HTMLButtonElement>('#import-apply')
const message = $('#import-message')
const pendingBox = $('#pending-box')
const pendingList = $<HTMLUListElement>('#pending-list')

/** Contenido del archivo elegido, ya leído como JSON. */
let file: unknown = null

const ACTIONS: Record<PlanItem['action'], string> = {
  register: 'Se registra desde GitHub, con su ficha',
  'needs-zip': 'Necesita su ZIP: lo eliges después',
  skip: 'Se omite',
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

function resetPreview(): void {
  file = null
  previewBox.hidden = true
  apply.hidden = true
  preview.replaceChildren()
}

function renderPreview(items: PlanItem[]): void {
  preview.replaceChildren(...items.map((item) => {
    const row = element('tr', item.action === 'skip' ? 'text-slate-500' : '')
    const name = element('td', 'px-3 py-2')
    name.append(element('p', 'font-semibold break-words text-slate-900', item.displayName), element('p', 'font-mono text-xs break-all', item.name))
    row.append(
      name,
      element('td', 'px-3 py-2', item.team),
      element('td', 'px-3 py-2', item.year === null ? '—' : String(item.year)),
      element('td', `px-3 py-2 ${item.action === 'skip' ? '' : item.action === 'needs-zip' ? 'text-amber-900' : 'text-emerald-800'}`,
        item.action === 'skip' ? `${ACTIONS.skip}: ${item.reason}` : ACTIONS[item.action]),
    )
    return row
  }))
  const useful = items.filter((item) => item.action !== 'skip').length
  previewBox.hidden = false
  apply.hidden = false
  apply.disabled = useful === 0
  apply.textContent = useful > 0 ? `Importar ${plural(useful, 'proyecto', 'proyectos')}` : 'No hay nada que importar'
}

async function choose(): Promise<void> {
  resetPreview()
  message.textContent = ''
  const chosen = fileInput.files?.[0]
  if (!chosen) return
  try {
    file = JSON.parse(await chosen.text())
  } catch {
    message.textContent = 'El archivo no es una lista exportada por Dockyard. Elige el .json que descargaste con Exportar lista.'
    return
  }
  message.textContent = 'Revisando la lista…'
  try {
    const { projects } = await api<{ projects: PlanItem[] }>('/api/import/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(file),
    })
    renderPreview(projects)
    message.textContent = projects.length === 0 ? 'La lista no tiene proyectos.' : ''
  } catch (error) {
    file = null
    message.textContent = messageOf(error, 'No se pudo leer la lista.')
  }
}

async function importList(): Promise<void> {
  if (!file) return
  apply.disabled = true
  message.textContent = 'Importando…'
  try {
    const result = await api<ImportResult>('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(file),
    })
    const parts: string[] = []
    if (result.queued.length > 0) parts.push(`${plural(result.queued.length, 'proyecto de GitHub se registra', 'proyectos de GitHub se registran')} de a uno; su avance se ve en Proyectos.`)
    if (result.needsZip.length > 0) parts.push(`${plural(result.needsZip.length, 'espera', 'esperan')} su ZIP: elígelo abajo.`)
    if (result.skipped.length > 0) parts.push(`Se ${result.skipped.length === 1 ? 'omitió' : 'omitieron'} ${result.skipped.map((item) => `${item.name} (${item.reason})`).join(', ')}.`)
    message.textContent = parts.join(' ') || 'No había nada que importar.'
    fileInput.value = ''
    resetPreview()
  } catch (error) {
    message.textContent = messageOf(error, 'No se pudo importar la lista.')
    apply.disabled = false
  }
  await loadPending()
}

function pickZip(): Promise<File | null> {
  const picker = document.createElement('input')
  picker.type = 'file'
  picker.accept = '.zip,application/zip'
  return new Promise((resolve) => {
    picker.addEventListener('change', () => resolve(picker.files?.[0] ?? null), { once: true })
    picker.addEventListener('cancel', () => resolve(null), { once: true })
    picker.click()
  })
}

function pendingItem(item: Pending): HTMLLIElement {
  const row = element('li', 'flex flex-col gap-2 rounded-md border border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between')
  const text = element('div', 'min-w-0')
  text.append(
    element('p', 'font-semibold break-words text-slate-900', item.displayName),
    element('p', 'text-sm text-slate-600', `${item.team}${item.year ? ` · ${item.year}` : ''}${item.zipName ? ` · antes: ${item.zipName}` : ''}`),
  )
  const status = element('p', 'text-xs text-slate-600')
  status.setAttribute('aria-live', 'polite')
  text.append(status)
  const buttons = element('div', 'flex shrink-0 gap-2')
  const register = element('button', 'ui-button ui-button-primary', 'Elegir ZIP y registrar')
  register.type = 'button'
  const dismiss = element('button', 'ui-button', 'Descartar')
  dismiss.type = 'button'
  register.addEventListener('click', async () => {
    const zip = await pickZip()
    if (!zip) return
    register.disabled = dismiss.disabled = true
    status.textContent = `Subiendo y preparando ${zip.name}…`
    const body = new FormData()
    body.append('file', zip)
    try {
      await api(`/api/import/pending/${encodeURIComponent(item.name)}`, { method: 'POST', body })
      message.textContent = `Se registró ${item.displayName} con su ficha.`
      await loadPending()
    } catch (error) {
      status.textContent = messageOf(error, 'No se pudo registrar.')
      status.className = 'text-xs text-red-700'
      register.disabled = dismiss.disabled = false
    }
  })
  dismiss.addEventListener('click', async () => {
    const confirmed = await confirmAction({
      title: `¿Descartar la ficha de ${item.displayName}?`,
      text: 'Deja de esperar su ZIP y se borra la ficha importada. Sigue en el archivo exportado: puedes importarla de nuevo.',
      confirmLabel: 'Descartar ficha',
    })
    if (!confirmed) return
    try {
      await api(`/api/import/pending/${encodeURIComponent(item.name)}`, { method: 'DELETE' })
    } catch (error) {
      status.textContent = messageOf(error, 'No se pudo descartar.')
    }
    await loadPending()
  })
  buttons.append(register, dismiss)
  row.append(text, buttons)
  return row
}

async function loadPending(): Promise<void> {
  try {
    const items = await api<Pending[]>('/api/import/pending')
    pendingList.replaceChildren(...items.map(pendingItem))
    pendingBox.hidden = items.length === 0
  } catch {
    // Configuración ya avisa si la API no responde.
  }
}

fileInput.addEventListener('change', () => void choose())
apply.addEventListener('click', () => void importList())
void loadPending()
