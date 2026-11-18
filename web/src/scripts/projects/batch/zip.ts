// «Varios» desde ZIP: el archivo vive en el navegador, así que se suben de a uno desde esta pestaña
// con el mismo registro de siempre. Si se cierra antes de terminar, los que faltan no se registran.
import { api, messageOf } from '../api.ts'
import { element } from '../element.ts'
import { loadYears } from '../folders.ts'
import { loadProjects } from '../list.ts'
import { loadRegistrations } from '../registrations.ts'
import { state } from '../state.ts'
import { normalizeName } from './parse.ts'

const form = document.querySelector<HTMLFormElement>('#batch-zip')!
const files = document.querySelector<HTMLInputElement>('#batch-files')!
const rows = document.querySelector<HTMLOListElement>('#batch-zip-rows')!
const status = document.querySelector<HTMLElement>('#batch-zip-status')!
const submit = document.querySelector<HTMLButtonElement>('#batch-zip-submit')!
const yearInput = document.querySelector<HTMLInputElement>('#batch-year')!

interface ZipRow {
  file: File
  team: HTMLInputElement
  name: HTMLInputElement
  status: HTMLElement
  done: boolean
}

let items: ZipRow[] = []
let uploading = false

function field(label: string, value: string, classes: string): [HTMLLabelElement, HTMLInputElement] {
  const wrapper = element('label', classes)
  wrapper.append(element('span', 'mb-1 block text-xs font-semibold text-slate-600', label))
  const input = element('input', 'w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm focus:border-marca-tinta disabled:bg-slate-100')
  input.value = value
  input.maxLength = 120
  wrapper.append(input)
  return [wrapper, input]
}

function showFiles(): void {
  items = [...(files.files ?? [])].map((file) => {
    const row = element('li', 'grid grid-cols-12 gap-2 rounded-md border border-slate-200 p-3')
    row.append(element('p', 'col-span-12 truncate font-mono text-xs text-slate-500', file.name))
    const [teamLabel, team] = field('Equipo', '', 'col-span-12 sm:col-span-5')
    const [nameLabel, name] = field('Nombre', normalizeName(file.name.replace(/\.zip$/i, '')), 'col-span-12 sm:col-span-7')
    const rowStatus = element('p', 'col-span-12 text-xs text-slate-600', 'Esperando')
    rowStatus.setAttribute('aria-live', 'polite')
    row.append(teamLabel, nameLabel, rowStatus)
    return { file, team, name, status: rowStatus, done: false }
  })
  rows.replaceChildren(...items.map((item) => item.status.parentElement!))
  submit.disabled = items.length === 0
  submit.textContent = items.length > 0 ? `Subir y registrar ${items.length} ZIP` : 'Subir y registrar los ZIP'
  status.textContent = ''
}

/** Mientras sube, el navegador pregunta antes de cerrar la pestaña. */
function warnBeforeLeaving(event: BeforeUnloadEvent): void {
  event.preventDefault()
}

async function upload(): Promise<void> {
  const pending = items.filter((item) => !item.done)
  if (uploading || pending.length === 0) return
  const missing = pending.find((item) => !item.team.value.trim() || !item.name.value.trim())
  if (missing) {
    status.textContent = 'Cada ZIP necesita su equipo y su nombre.'
    ;(missing.team.value.trim() ? missing.name : missing.team).focus()
    return
  }
  uploading = true
  submit.disabled = true
  files.disabled = true
  addEventListener('beforeunload', warnBeforeLeaving)
  let registered = 0
  const year = String(Number(yearInput.value) || new Date().getFullYear())
  for (const [index, item] of pending.entries()) {
    status.textContent = `Subiendo ${index + 1} de ${pending.length}. No cierres esta pestaña hasta terminar.`
    item.team.disabled = item.name.disabled = true
    item.status.textContent = 'Subiendo y preparando…'
    item.status.className = 'col-span-12 text-xs font-semibold text-slate-800'
    const body = new FormData()
    body.set('team', item.team.value.trim())
    body.set('name', item.name.value.trim())
    body.set('year', year)
    body.set('file', item.file)
    state.registering++
    setTimeout(() => void loadRegistrations(), 300)
    try {
      await api('/api/projects', { method: 'POST', body })
      item.done = true
      registered++
      item.status.textContent = 'Registrado'
      item.status.className = 'col-span-12 text-xs font-semibold text-emerald-800'
    } catch (error) {
      item.team.disabled = item.name.disabled = false
      item.status.textContent = messageOf(error, 'No se pudo registrar.')
      item.status.className = 'col-span-12 text-xs text-red-700'
    } finally {
      state.registering--
    }
  }
  removeEventListener('beforeunload', warnBeforeLeaving)
  uploading = false
  files.disabled = false
  const failed = pending.length - registered
  status.textContent = failed === 0
    ? `Se ${registered === 1 ? 'registró 1 proyecto' : `registraron ${registered} proyectos`}.`
    : `Se registraron ${registered} de ${pending.length}. Corrige los que fallaron y vuelve a presionar el botón.`
  submit.disabled = failed === 0
  await Promise.all([loadYears(), loadRegistrations()])
  await loadProjects(true)
}

export function setupBatchZip(): void {
  files.addEventListener('change', showFiles)
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    void upload()
  })
}
