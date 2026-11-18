// Punto de entrada de la ficha de un proyecto (/proyecto/?id=<id>). La API es la fuente de verdad:
// aquí se carga, se muestra y se envían las acciones.
import { api, ApiResponseError, messageOf, requestWithRetries } from '../projects/api.ts'
import type { Project, Resources } from '../projects/types.ts'
import { showMessage, view } from './dom.ts'
import { isEditing, openEditor, setupEditForm } from './edit-form.ts'
import { renderView, type ViewState } from './view.ts'

const REFRESH_INTERVAL_MS = 15_000
const RESOURCES_INTERVAL_MS = 10_000

const id = Number(new URLSearchParams(location.search).get('id'))
let project: Project | null = null
const state: ViewState = { pending: null, resources: null }

function render(): void {
  if (project) renderView(project, state)
}

function showLoadError(message: string): void {
  view.loading.hidden = true
  view.root.hidden = true
  view.error.textContent = message
  view.error.classList.remove('hidden')
}

async function load(silent = false): Promise<void> {
  try {
    project = await api<Project>(`/api/projects/${id}`)
    view.error.classList.add('hidden')
    if (!isEditing()) render()
  } catch (error) {
    if (error instanceof ApiResponseError && error.status === 404) {
      showLoadError('Ese proyecto no existe. Puede que se haya eliminado.')
    } else if (!silent) {
      showLoadError(messageOf(error, 'No se pudo cargar el proyecto.'))
    }
  }
}

async function pollResources(): Promise<void> {
  if (!project || project.state !== 'running' || document.hidden) {
    state.resources = null
    return
  }
  try {
    const resources = await api<Resources>('/api/projects/resources')
    state.resources = resources.projects[project.id] ?? null
  } catch {
    state.resources = null
  }
  if (!isEditing()) render()
}

async function toggle(): Promise<void> {
  if (!project || state.pending) return
  const action = project.state === 'running' ? 'stop' : 'start'
  state.pending = action
  view.actionError.classList.add('hidden')
  showMessage(null)
  render()
  try {
    project = await requestWithRetries<Project>(`/api/projects/${project.id}/${action}`, 'POST')
  } catch (error) {
    view.actionError.textContent = messageOf(error, 'No se pudo cambiar el estado.')
    view.actionError.classList.remove('hidden')
  } finally {
    state.pending = null
    render()
    void pollResources()
  }
}

setupEditForm((updated, message) => {
  project = updated
  render()
  showMessage(message || null)
})
view.toggle.addEventListener('click', () => void toggle())
view.edit.addEventListener('click', () => {
  showMessage(null)
  if (project) openEditor(project)
})

if (!Number.isInteger(id) || id < 1) {
  showLoadError('Falta el proyecto en la dirección. Vuelve a Proyectos y elige uno.')
} else {
  void load().then(() => {
    if (project && location.hash === '#editar') openEditor(project)
    void pollResources()
  })
  setInterval(() => {
    if (!document.hidden && !isEditing() && !state.pending) void load(true)
  }, REFRESH_INTERVAL_MS)
  setInterval(() => void pollResources(), RESOURCES_INTERVAL_MS)
}
