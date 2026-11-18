// Carga de la lista de proyectos de la carpeta abierta, con búsqueda.
import { api, CONNECTION_MESSAGE, messageOf } from './api.ts'
import { hideGlobalMessage, page, showGlobalMessage } from './dom.ts'
import { folderQuery } from './folders.ts'
import { state } from './state.ts'
import { render } from './table.ts'
import type { Project } from './types.ts'

let latestLoad = 0

/**
 * Devuelve true si la lista se cargó. Una respuesta que ya no es la última se descarta.
 * Con silent no muestra "Cargando" ni redibuja si nada cambió: es el refresco automático.
 */
export async function loadProjects(silent = false): Promise<boolean> {
  const load = ++latestLoad
  const wasFailed = state.loadFailed
  if (!silent) {
    state.loading = true
    render()
  }
  let result: Project[] | undefined
  let message = ''
  try {
    const query = page.searchInput.value.trim()
    // La búsqueda mira dentro de la carpeta abierta.
    const params = new URLSearchParams({ ...folderQuery(), ...(query ? { q: query } : {}) })
    result = await api<Project[]>(`/api/projects${params.size > 0 ? `?${params}` : ''}`)
  } catch (error) {
    message = messageOf(error, CONNECTION_MESSAGE)
  }
  if (load !== latestLoad) return false

  const unchanged = silent && !wasFailed && result !== undefined
    && JSON.stringify(result) === JSON.stringify(state.projects)
  state.loading = false
  state.loadFailed = result === undefined
  state.projects = result ?? []
  // El refresco no borra un aviso de éxito; solo el error que él mismo vino a resolver.
  if (!result) showGlobalMessage(message, 'error')
  else if (!silent || wasFailed) hideGlobalMessage()
  if (!unchanged) render()
  return result !== undefined
}
