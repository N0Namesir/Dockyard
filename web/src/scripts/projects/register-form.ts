// Formulario para registrar un proyecto desde GitHub o un ZIP.
import { api, messageOf } from './api.ts'
import { hideGlobalMessage, page, showGlobalMessage } from './dom.ts'
import { loadProjects } from './list.ts'
import type { Project } from './types.ts'

const form = document.querySelector<HTMLFormElement>('#register-form')!
const button = document.querySelector<HTMLButtonElement>('#register-button')!
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

async function submit(event: SubmitEvent): Promise<void> {
  event.preventDefault()
  formError.classList.add('hidden')
  hideGlobalMessage()
  if (!form.reportValidity()) return

  const formData = new FormData(form)
  button.disabled = true
  button.textContent = 'Registrando…'
  try {
    const created = await api<Project>('/api/projects', requestFor(formData))
    form.reset()
    updateSourceFields()
    page.searchInput.value = ''
    if (await loadProjects()) {
      if (created.warnings.length > 0) {
        showGlobalMessage('El proyecto se registró, pero la revisión encontró avisos. Léelos en su fila antes de encenderlo.', 'warning')
      } else {
        showGlobalMessage('El proyecto se registró correctamente.', 'success')
      }
    }
  } catch (error) {
    formError.textContent = messageOf(error, 'No se pudo registrar el proyecto.')
    formError.classList.remove('hidden')
  } finally {
    button.disabled = false
    button.textContent = 'Registrar proyecto'
  }
}

export function setupRegisterForm(): void {
  form.addEventListener('change', (event) => {
    if ((event.target as HTMLInputElement).name === 'source') updateSourceFields()
  })
  form.addEventListener('submit', (event) => void submit(event))
  updateSourceFields()
}
