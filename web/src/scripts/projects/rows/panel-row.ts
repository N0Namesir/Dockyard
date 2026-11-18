import { element } from '../element.ts'

/** Fila de la tabla que ocupa todo el ancho, debajo de la de su proyecto: avance, avisos o registro. */
export function panelRow(panel: HTMLElement, classes: string): HTMLTableRowElement {
  const row = element('tr')
  const cell = element('td', classes)
  cell.colSpan = 5
  cell.append(panel)
  row.append(cell)
  return row
}
