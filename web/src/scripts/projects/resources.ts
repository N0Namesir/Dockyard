// Consumo de CPU y memoria. Es un dato de apoyo: si falla, no interrumpe al docente.
import { api } from './api.ts'
import { page } from './dom.ts'
import { bytesText, cpuText } from './format.ts'
import { state } from './state.ts'
import type { Resources } from './types.ts'

export function fillResources(target: HTMLElement, id: number): void {
  const usage = state.resources?.projects[id]
  target.textContent = usage ? `CPU ${cpuText(usage.cpuPercent)}, memoria ${bytesText(usage.memoryBytes)}` : ''
  target.title = usage?.services
    .map((service) => `${service.service}: CPU ${cpuText(service.cpuPercent)}, memoria ${bytesText(service.memoryBytes)}`)
    .join('\n') ?? ''
}

let polling = false

/** Actualiza solo los textos del consumo, sin redibujar la tabla. */
export async function pollResources(): Promise<void> {
  if (polling || document.hidden) return
  if (!state.projects.some((project) => project.state === 'running')) {
    state.resources = null
    page.resourcesTotal.textContent = ''
    return
  }
  polling = true
  try {
    state.resources = await api<Resources>('/api/projects/resources')
    const { total, memoryLimit } = state.resources
    page.resourcesTotal.textContent = total.memoryBytes > 0
      ? `Consumo de proyectos: CPU ${cpuText(total.cpuPercent)} · RAM ${bytesText(total.memoryBytes)} / ${bytesText(memoryLimit)} de la PC.`
      : ''
    for (const target of page.projectsArea.querySelectorAll<HTMLElement>('[data-resources]')) {
      fillResources(target, Number(target.dataset.resources))
    }
  } catch {
    state.resources = null
    page.resourcesTotal.textContent = ''
  } finally {
    polling = false
  }
}
