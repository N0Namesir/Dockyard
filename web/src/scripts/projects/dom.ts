// Elementos fijos de la página de proyectos (web/src/pages/index.astro) y su mensaje general.
// Los ayudantes para crear elementos están en element.ts, que también usan otras páginas.
export { element, isSelectingIn } from './element.ts'

function required<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector)
  if (!node) throw new Error(`Falta ${selector} en la página.`)
  return node
}

export const page = {
  projectsBody: required<HTMLTableSectionElement>('#projects'),
  projectCount: required<HTMLElement>('#project-count'),
  resourcesTotal: required<HTMLElement>('#resources-total'),
  searchInput: required<HTMLInputElement>('#search'),
  stopAll: required<HTMLButtonElement>('#stop-all'),
  globalMessage: required<HTMLElement>('#global-message'),
}

export function showGlobalMessage(message: string, kind: 'error' | 'success' | 'warning'): void {
  page.globalMessage.textContent = message
  page.globalMessage.className = `mb-6 rounded-md border px-4 py-3 text-sm ${
    kind === 'error'
      ? 'border-red-200 bg-red-50 text-red-800'
      : kind === 'warning'
        ? 'border-amber-300 bg-amber-50 text-amber-900'
        : 'border-emerald-200 bg-emerald-50 text-emerald-800'
  }`
}

export function hideGlobalMessage(): void {
  page.globalMessage.classList.add('hidden')
}
