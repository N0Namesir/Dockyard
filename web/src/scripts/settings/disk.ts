// Sección "Espacio en disco" de Configuración. La API mide y decide qué se puede borrar; aquí solo
// se muestra y se pide confirmar antes de liberar.
import { api, messageOf } from '../projects/api.ts'
import { confirmAction } from '../projects/confirm-dialog.ts'
import { bytesText } from '../projects/format.ts'

interface DiskUsage {
  imageBytes: number
  unusedImageBytes: number
  volumeBytes: number
}

interface DiskResponse {
  total: DiskUsage
  projects: ({ id: number; name: string } & DiskUsage)[]
}

interface CleanResult {
  freedBytes: number
  removed: number
}

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!
const total = $('#disk-total')
const rows = $<HTMLTableSectionElement>('#disk-rows')
const clean = $<HTMLButtonElement>('#disk-clean')
const message = $('#disk-message')

let usage: DiskResponse | null = null

function cell(text: string, classes = 'px-3 py-2 text-right tabular-nums'): HTMLTableCellElement {
  const node = document.createElement('td')
  node.className = classes
  node.textContent = text
  return node
}

function render(): void {
  rows.replaceChildren()
  if (!usage) return
  const { imageBytes, unusedImageBytes, volumeBytes } = usage.total
  total.textContent = usage.projects.length === 0
    ? 'No hay proyectos registrados.'
    : `Los proyectos registrados ocupan ${bytesText(imageBytes + unusedImageBytes + volumeBytes)}: ${bytesText(imageBytes)} en imágenes, ${bytesText(unusedImageBytes)} en versiones viejas y ${bytesText(volumeBytes)} en datos.`
  for (const project of usage.projects) {
    const row = document.createElement('tr')
    row.append(
      cell(project.name, 'px-3 py-2 font-semibold break-all text-slate-900'),
      cell(bytesText(project.imageBytes)),
      cell(bytesText(project.unusedImageBytes)),
      cell(bytesText(project.volumeBytes)),
    )
    rows.append(row)
  }
  clean.disabled = unusedImageBytes === 0
  clean.title = unusedImageBytes === 0 ? 'No hay versiones viejas que borrar.' : ''
}

async function load(): Promise<void> {
  try {
    usage = await api<DiskResponse>('/api/disk')
    render()
  } catch (error) {
    total.textContent = messageOf(error, 'No se pudo medir el espacio en disco.')
  }
}

async function free(): Promise<void> {
  if (!usage) return
  const estimate = usage.total.unusedImageBytes
  const confirmed = await confirmAction({
    title: '¿Liberar espacio?',
    text: `Se borran las versiones viejas de las imágenes de los proyectos registrados: unos ${bytesText(estimate)}. Los proyectos, su código y sus datos no se tocan, y nada se reconstruye al encender.`,
    confirmLabel: 'Liberar espacio',
  })
  if (!confirmed) return
  clean.disabled = true
  message.textContent = 'Liberando espacio…'
  try {
    const result = await api<CleanResult>('/api/disk/clean', { method: 'POST' })
    message.textContent = result.removed === 0
      ? 'No había versiones viejas que borrar.'
      : `Se liberaron ${bytesText(result.freedBytes)} (${result.removed} ${result.removed === 1 ? 'imagen' : 'imágenes'}).`
  } catch (error) {
    message.textContent = messageOf(error, 'No se pudo liberar espacio.')
  }
  await load()
}

clean.addEventListener('click', () => void free())
void load()
