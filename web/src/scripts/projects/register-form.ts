// Formulario para registrar un proyecto desde GitHub o un ZIP.
import { registrationSubmitted } from './register-panel.ts'
import { api, ApiResponseError, messageOf } from './api.ts'
import { hideGlobalMessage, page, showGlobalMessage } from './dom.ts'
import { loadYears, selectFolder } from './folders.ts'
import { loadProjects } from './list.ts'
import { loadRegistrations } from './registrations.ts'
import { state } from './state.ts'
import type { Project } from './types.ts'

const submissions = new Map<symbol, string>()
function showSubmissions(): void {
  document.querySelector<HTMLElement>('#registration-status')!.textContent = submissions.size
    ? `Registro en curso: ${[...submissions.values()].join(', ')}. Enviando y preparando los proyectos…` : ''
}

const form = document.querySelector<HTMLFormElement>('#register-form')!
const formError = document.querySelector<HTMLElement>('#form-error')!
const gitField = document.querySelector<HTMLElement>('#git-field')!
const zipField = document.querySelector<HTMLElement>('#zip-field')!
const repoInput = form.elements.namedItem('repoUrl') as HTMLInputElement
const fileInput = form.elements.namedItem('file') as HTMLInputElement
const nameInput = form.elements.namedItem('name') as HTMLInputElement
const yearInput = form.elements.namedItem('year') as HTMLInputElement
const displayNameInput = form.elements.namedItem('displayName') as HTMLInputElement
const useSuggestion = document.querySelector<HTMLButtonElement>('#use-suggestion')!
/** Campos que se envían y se recuperan si el registro falla. */
const TEXT_FIELDS = ['team', 'name', 'displayName', 'year', 'repoUrl']

/** El año de una entrega nueva suele ser el actual. */
function fillDefaults(): void {
  if (!yearInput.value) yearInput.value = String(new Date().getFullYear())
}

function hideSuggestion(): void {
  useSuggestion.hidden = true
}

/**
 * El nombre ya existe, como el proyecto de otro año: ofrece usar el que propone la API con un clic.
 * Lo que el docente escribió sigue siendo el nombre para mostrar.
 */
function offerSuggestion(suggestion: string, typed: string): void {
  useSuggestion.textContent = `Usar el nombre «${suggestion}»`
  useSuggestion.hidden = false
  useSuggestion.onclick = () => {
    if (!displayNameInput.value) displayNameInput.value = typed
    nameInput.value = suggestion
    formError.classList.add('hidden')
    hideSuggestion()
    nameInput.focus()
  }
}

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
        ...(formData.get('displayName') ? { displayName: formData.get('displayName') } : {}),
        year: Number(formData.get('year')),
      }),
    }
  }
  const upload = new FormData()
  upload.set('team', String(formData.get('team') ?? ''))
  upload.set('name', String(formData.get('name') ?? ''))
  if (formData.get('displayName')) upload.set('displayName', String(formData.get('displayName')))
  upload.set('year', String(formData.get('year') ?? ''))
  const file = formData.get('file')
  if (file instanceof File) upload.set('file', file)
  return { method: 'POST', body: upload }
}

/** Vuelve a poner lo enviado si el registro falla y el docente no empezó a llenar otro. */
function restore(formData: FormData, source: 'git' | 'zip'): boolean {
  const untouched = ['team', 'name', 'repoUrl'].every((field) => !(form.elements.namedItem(field) as HTMLInputElement).value)
    && !fileInput.files?.length
  if (!untouched) return false
  for (const field of TEXT_FIELDS) {
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
  hideSuggestion()
  hideGlobalMessage()
  if (!form.reportValidity()) return

  const formData = new FormData(form)
  const source = selectedSource()
  const request = requestFor(formData)
  const name = String(formData.get('name') ?? '').trim()
  const keepOpen = document.querySelector<HTMLInputElement>('#register-another')!.checked
  form.reset()
  document.querySelector<HTMLInputElement>('#register-another')!.checked = keepOpen
  // El año se conserva: los proyectos de una tanda suelen ser del mismo.
  yearInput.value = String(formData.get('year') ?? '')
  fillDefaults()
  updateSourceFields()
  state.registering++
  const feedback = document.querySelector<HTMLElement>('#register-feedback')!
  feedback.textContent = `Enviando ${name}. Puedes registrar otro proyecto.`
  const submission = Symbol(name)
  submissions.set(submission, name)
  showSubmissions()
  registrationSubmitted()
  // Aparece en la lista en cuanto la API lo recibe (un ZIP, después de subirse).
  setTimeout(() => void loadRegistrations(), 300)
  try {
    const created = await api<Project>('/api/projects', request)
    feedback.textContent = `${created.name} se registró. Puedes registrar otro proyecto.`
    page.searchInput.value = ''
    // Se abre su carpeta para que se vea; en «Todos» ya se ve.
    await loadYears()
    if (state.folder !== 'todos' && state.folder !== created.year) selectFolder(created.year)
    if (await loadProjects()) {
      if (created.warnings.length > 0) {
        showGlobalMessage(`${created.name} se registró, pero la revisión encontró avisos. Léelos en su fila antes de encenderlo.`, 'warning')
      } else {
        showGlobalMessage(`${created.name} se registró correctamente.`, 'success')
      }
    }
  } catch (error) {
    feedback.textContent = ''
    const message = messageOf(error, 'No se pudo registrar el proyecto.')
    if (restore(formData, source)) {
      formError.textContent = message
      formError.classList.remove('hidden')
      if (error instanceof ApiResponseError && error.body.suggestion) {
        offerSuggestion(error.body.suggestion, String(formData.get('displayName') || name))
      }
      showGlobalMessage(`No se registró ${name}: ${message}. Abre Registrar proyecto para corregir los datos.`, 'error')
    } else {
      showGlobalMessage(`No se registró ${name}: ${message}`, 'error')
    }
  } finally {
    submissions.delete(submission)
    showSubmissions()
    state.registering--
    if (state.registering > 0) feedback.textContent = `Quedan ${state.registering} registros en curso.`
    await loadRegistrations()
  }
}

export function setupRegisterForm(): void {
  form.addEventListener('change', (event) => {
    if ((event.target as HTMLInputElement).name === 'source') updateSourceFields()
  })
  form.addEventListener('submit', (event) => void submit(event))
  nameInput.addEventListener('input', () => {
    // Otro nombre escrito a mano también es otro nombre para mostrar.
    displayNameInput.value = ''
    hideSuggestion()
  })
  fillDefaults()
  updateSourceFields()
}
