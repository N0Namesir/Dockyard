// Los refrescos pueden reemplazar el botón que abrió un diálogo nativo.
// Conservamos su identidad lógica para devolver el foco aunque ese nodo ya no exista.
export function setupDialogFocus(): void {
  let origin: string | undefined
  const origins = new WeakMap<HTMLDialogElement, string>()
  document.addEventListener('focusin', (event) => {
    if (!(event.target instanceof HTMLElement)) return
    const dialog = event.target.closest('dialog')
    if (dialog) {
      if (origin && !origins.has(dialog)) origins.set(dialog, origin)
      return
    }
    origin = event.target.closest<HTMLElement>('[data-row-key]')?.dataset.rowKey
  })
  for (const dialog of document.querySelectorAll('dialog')) {
    dialog.addEventListener('close', () => {
      const key = origins.get(dialog)
      origins.delete(dialog)
      if (!key) return
      const row = [...document.querySelectorAll<HTMLElement>('[data-row-key]')].find(item => item.dataset.rowKey === key)
      const target = row?.querySelector<HTMLElement>('[data-action="menu"]') ?? document.querySelector<HTMLElement>('#search')
      target?.focus({ preventScroll: true })
    })
  }
}
