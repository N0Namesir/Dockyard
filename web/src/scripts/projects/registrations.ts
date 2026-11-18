// Registros en segundo plano: la API descarga o descomprime el proyecto aunque se cierre la pestaña,
// y aquí solo se muestra su etapa. Un registro que termina aparece como proyecto en la lista.
import { api, messageOf } from './api.ts'
import { page, showGlobalMessage } from './dom.ts'
import { loadProjects } from './list.ts'
import { fillRegistration } from './rows/registration-row.ts'
import { state } from './state.ts'
import { render } from './table.ts'
import type { Registration } from './types.ts'

let polling = false

/** Pide la lista a la API. Solo redibuja la tabla si cambió qué registros hay o cuál falló. */
export async function loadRegistrations(): Promise<void> {
  if (polling) return
  polling = true
  let result: Registration[]
  try {
    result = await api<Registration[]>('/api/registrations')
  } catch {
    // Se reintenta en la siguiente vuelta; la lista de proyectos ya avisa si la API no responde.
    return
  } finally {
    polling = false
  }
  const shape = (list: Registration[]) => list.map((item) => `${item.key}:${item.error ?? ''}`).join('|')
  const finished = state.registrations.some((before) =>
    before.error === null && !result.some((after) => after.key === before.key))
  const changed = shape(result) !== shape(state.registrations)
  state.registrations = result
  if (changed) render()
  else {
    for (const registration of result) {
      const row = page.projectsArea.querySelector<HTMLElement>(`[data-registration="${registration.key}"]`)
      if (row && registration.error === null) fillRegistration(row, registration)
    }
  }
  // Terminó uno que no envió esta pestaña (otra pestaña, o esta antes de recargar): ya es un proyecto.
  if (finished) void loadProjects(true)
}

/** Consulta seguido solo mientras hay algo registrándose. */
export function pollRegistrations(): void {
  const active = state.registering > 0 || state.registrations.some((item) => item.error === null)
  if (active && !document.hidden) void loadRegistrations()
}

export async function dismissRegistration(registration: Registration): Promise<void> {
  try {
    await api<void>(`/api/registrations/${registration.key}`, { method: 'DELETE' })
  } catch (error) {
    showGlobalMessage(messageOf(error, 'No se pudo descartar.'), 'error')
  }
  await loadRegistrations()
}
