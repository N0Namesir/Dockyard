// Selector Tabla | Cuadrícula. La preferencia se guarda en la API, así es la misma en cualquier
// navegador del docente.
import { api, messageOf } from './api.ts'
import { page, showGlobalMessage } from './dom.ts'
import { state } from './state.ts'
import { render } from './table.ts'
import type { ProjectsView } from './types.ts'

export async function loadView(): Promise<void> {
  try {
    const settings = await api<{ projectsView?: ProjectsView }>('/api/settings')
    state.view = settings.projectsView === 'grid' ? 'grid' : 'table'
  } catch {
    // Sin la preferencia se usa la tabla; la lista avisa si la API no responde.
  }
}

async function choose(view: ProjectsView): Promise<void> {
  if (view === state.view) return
  state.view = view
  render()
  try {
    await api('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectsView: view }),
    })
  } catch (error) {
    showGlobalMessage(`No se pudo guardar la vista: ${messageOf(error, 'error desconocido.')}`, 'error')
  }
}

export function setupViewToggle(): void {
  for (const button of page.viewButtons) {
    button.addEventListener('click', () => void choose(button.dataset.view === 'grid' ? 'grid' : 'table'))
  }
}
