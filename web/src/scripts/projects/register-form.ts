// Formulario para registrar un proyecto desde GitHub o un ZIP.
import { api, messageOf } from './api.ts'
import { hideGlobalMessage, page, showGlobalMessage } from './dom.ts'
import { loadProjects } from './list.ts'
import { loadRegistrations } from './registrations.ts'
import { state } from './state.ts'
import type { Project } from './types.ts'

const form = document.querySelector<HTMLFormElement>('#register-form')!
const formError = document.querySelector<HTMLElement>('#form-error')!
const gitField = document.querySelector<HTMLElement>('#git-field')!
const zipField = document.querySelector<HTMLElement>('#zip-field')!
const repoInput = form.elements.namedItem('repoUrl') as HTMLInputElement
const fileInput = form.elements.namedItem('file') as HTMLInputElement

function selectedSource(): 'git' | 'zip' {
  const selected = form.querySelector<HTMLInputElement>('input[name="source"]:checked')
  return selected?.value === 'zip' ? 'zip' : 'git'
}

function updateSourceFields(): void {
  const isGit = selectedSource() === 'git'
  gitField.classList.toggle('hidden', !isGit)
  zipField.classList.toggle('hidden', isGit)
  repoInput.required = isGit
  fileInput.required = !isGit
}

function requestFor(formData: FormData): RequestInit {
  if (selectedSource() === 'git') {
    return {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        team: formData.get('team'),
        name: formData.get('name'),
        repoUrl: formData.get('repoUrl'),
      }),
    }
  }
  const upload = new FormData()
  upload.set('team', String(formData.get('team') ?? ''))
  upload.set('name', String(formData.get('name') ?? ''))
  const file = formData.get('file')
  if (file instanceof File) upload.set('file', file)
  return { method: 'POST', body: upload }
}

/** Vuelve a poner lo enviado si el registro falla y el docente no empezó a llenar otro. */
function restore(formData: FormData, source: 'git' | 'zip'): boolean {
  const untouched = ['team', 'name', 'repoUrl'].every((field) => !(form.elements.namedItem(field) as HTMLInputElement).value)
    && !fileInput.files?.length
  if (!untouched) return false
  for (const field of ['team', 'name', 'repoUrl']) {
    (form.elements.namedItem(field) as HTMLInputElement).value = String(formData.get(field) ?? '')
  }
  form.querySelector<HTMLInputElement>(`input[name="source"][value="${source}"]`)!.checked = true
  const file = formData.get('file')
  if (file instanceof File && file.size > 0) {
    const transfer = new DataTransfer()
    transfer.items.add(file)
    fileInput.files = transfer.files
  }
  updateSourceFields()
  return true
}

/**
 * Envía el registro y deja el formulario libre enseguida: la descarga sigue en la API y su avance
 * se ve en la lista. Se pueden registrar varios a la vez.
 */
async function submit(event: SubmitEvent): Promise<void> {
  event.preventDefault()
  formError.classList.add('hidden')
  hideGlobalMessage()
  if (!form.reportValidity()) return

  const formData = new FormData(form)
  const source = selectedSource()
  const request = requestFor(formData)
  const name = String(formData.get('name') ?? '').trim()
  form.reset()
  updateSourceFields()
  state.registering++
  // Aparece en la lista en cuanto la API lo recibe (un ZIP, después de subirse).
  setTimeout(() => void loadRegistrations(), 300)
  try {
    const created = await api<Project>('/api/projects', request)
    page.searchInput.value = ''
    if (await loadProjects()) {
      if (created.warnings.length > 0) {
        showGlobalMessage(`${created.name} se registró, pero la revisión encontró avisos. Léelos en su fila antes de encenderlo.`, 'warning')
      } else {
        showGlobalMessage(`${created.name} se registró correctamente.`, 'success')
      }
    }
  } catch (error) {
    const message = messageOf(error, 'No se pudo registrar el proyecto.')
    if (restore(formData, source)) {
      formError.textContent = message
      formError.classList.remove('hidden')
    } else {
      showGlobalMessage(`No se registró ${name}: ${message}`, 'error')
    }
  } finally {
    state.registering--
    await loadRegistrations()
  }
}

export function setupRegisterForm(): void {
  form.addEventListener('change', (event) => {
    if ((event.target as HTMLInputElement).name === 'source') updateSourceFields()
  })
  form.addEventListener('submit', (event) => void submit(event))
  updateSourceFields()
}
