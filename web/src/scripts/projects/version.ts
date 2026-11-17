// La API decide si hay una versión nueva y cuándo consultar GitHub; aquí solo se muestra.
import { api } from './api.ts'
import type { VersionInfo } from './types.ts'

export async function pollVersion(): Promise<void> {
  if (document.hidden) return
  try {
    const { current, latest, updateAvailable } = await api<VersionInfo>('/api/version')
    document.querySelector('#version-latest')!.textContent = latest
    document.querySelector('#version-current')!.textContent = `v${current}`
    document.querySelector('#version-notice')!.classList.toggle('hidden', !updateAvailable)
  } catch {
    // Es un dato de apoyo: si falla, no se interrumpe al docente.
  }
}
