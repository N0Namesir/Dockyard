// Carpetas por año: una por año con proyectos y «Todos». La carpeta abierta va en la URL (?año=),
// así recargar o compartir el enlace la conserva. La API filtra la lista; aquí solo se elige.
import { api } from './api.ts'
import { element, page } from './dom.ts'
import { state } from './state.ts'
import type { Folder, YearFolder } from './types.ts'

const PARAM = 'año'
let changed: () => void = () => {}

function folderFromUrl(): Folder | null {
  const value = new URLSearchParams(location.search).get(PARAM)
  if (value === 'todos') return 'todos'
  return value && /^\d{4}$/.test(value) ? Number(value) : null
}

/** La de la URL o, si no hay, el año más reciente con proyectos. */
function defaultFolder(): Folder {
  return folderFromUrl() ?? state.years[0]?.year ?? 'todos'
}

/** Parámetro de la lista para la API: vacío en «Todos». */
export function folderQuery(): Record<string, string> {
  return state.folder === 'todos' ? {} : { year: String(state.folder) }
}

export function folderName(folder: Folder): string {
  return folder === 'todos' ? 'Todos' : String(folder)
}

export async function loadYears(): Promise<void> {
  try {
    state.years = await api<YearFolder[]>('/api/projects/years')
  } catch {
    // La lista ya avisa si la API no responde; las carpetas quedan como estaban.
  }
  renderFolders()
}

/** Elige la carpeta y la guarda en la URL, sin cargar la lista. */
export function selectFolder(folder: Folder): void {
  if (folder === state.folder) return
  state.folder = folder
  const url = new URL(location.href)
  url.searchParams.set(PARAM, String(folder))
  history.pushState(null, '', url)
  renderFolders()
}

/** Abre una carpeta y carga su lista. */
export function openFolder(folder: Folder): void {
  if (folder === state.folder) return
  selectFolder(folder)
  changed()
}

function folderLink(folder: Folder, count: number, running: number): HTMLLIElement {
  const item = element('li', 'shrink-0')
  const link = element('a', 'folder-link')
  link.href = `?${PARAM}=${folder}`
  if (folder === state.folder) link.setAttribute('aria-current', 'page')
  const title = element('span')
  const icon = element('span', '', '📁 ')
  icon.setAttribute('aria-hidden', 'true')
  title.append(icon, `${folderName(folder)} · ${count}`)
  link.append(title)
  if (running > 0) link.append(element('span', 'text-xs font-normal text-emerald-800', `${running} ${running === 1 ? 'encendido' : 'encendidos'}`))
  link.setAttribute('aria-label', `${folderName(folder)}: ${count} ${count === 1 ? 'proyecto' : 'proyectos'}${running > 0 ? `, ${running} encendidos` : ''}`)
  link.addEventListener('click', (event) => {
    // Con Ctrl o el botón del medio, el navegador abre otra pestaña como con cualquier enlace.
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return
    event.preventDefault()
    openFolder(folder)
  })
  item.append(link)
  return item
}

export function renderFolders(): void {
  const years = [...state.years]
  // La carpeta abierta se ve aunque ya no tenga proyectos, por ejemplo tras eliminar el último.
  if (typeof state.folder === 'number' && !years.some((item) => item.year === state.folder)) {
    years.push({ year: state.folder, count: 0, running: 0 })
    years.sort((a, b) => b.year - a.year)
  }
  const total = state.years.reduce((sum, item) => sum + item.count, 0)
  const running = state.years.reduce((sum, item) => sum + item.running, 0)
  page.folderList.replaceChildren(
    ...years.map((item) => folderLink(item.year, item.count, item.running)),
    folderLink('todos', total, running),
  )
}

/** Primera carga, con los años ya leídos: la carpeta de la URL o la del año más reciente. */
export function pickInitialFolder(): void {
  state.folder = defaultFolder()
  renderFolders()
}

/** Atrás y Adelante del navegador cambian de carpeta. */
export function setupFolders(onChange: () => void): void {
  changed = onChange
  addEventListener('popstate', () => {
    const folder = defaultFolder()
    if (folder === state.folder) return
    state.folder = folder
    renderFolders()
    changed()
  })
}
