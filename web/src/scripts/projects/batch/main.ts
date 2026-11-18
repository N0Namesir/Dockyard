// Pestaña «Varios» del panel de registro: listas de GitHub y varios ZIP.
import { api } from '../api.ts'
import { state } from '../state.ts'
import type { Project } from '../types.ts'
import { setTakenNames, setupBatchGit } from './git.ts'
import { setupRegisterTabs } from './tabs.ts'
import { setupBatchZip } from './zip.ts'

const yearInput = document.querySelector<HTMLInputElement>('#batch-year')!

/** Al abrir Varios: qué nombres ya existen, en todos los años, para avisarlo en la vista previa. */
async function loadTakenNames(): Promise<void> {
  if (!yearInput.value) yearInput.value = String(new Date().getFullYear())
  const names = new Set(state.registrations.map((item) => item.name))
  try {
    for (const project of await api<Project[]>('/api/projects?year=todos')) names.add(project.name)
  } catch {
    // Sin la lista, la API igual rechaza los nombres repetidos al enviar.
  }
  setTakenNames(names)
}

export function setupBatch(): void {
  setupRegisterTabs(() => void loadTakenNames())
  setupBatchGit()
  setupBatchZip()
}
