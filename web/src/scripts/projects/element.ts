// Ayudantes del DOM que no dependen de ninguna página: los comparten Proyectos, la ficha y Configuración.

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  classes?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (classes) node.className = classes
  if (text !== undefined) node.textContent = text
  return node
}

/** true si el docente tiene texto seleccionado dentro de target: no hay que reemplazarlo. */
export function isSelectingIn(target: HTMLElement): boolean {
  const selection = document.getSelection()
  return selection !== null && !selection.isCollapsed && selection.containsNode(target, true)
}
