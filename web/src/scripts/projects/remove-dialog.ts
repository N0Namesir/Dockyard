// Eliminar no se puede deshacer: solo se habilita al escribir el nombre exacto del proyecto.

const dialog = document.querySelector<HTMLDialogElement>('#remove-dialog')!
const title = document.querySelector<HTMLElement>('#remove-dialog-title')!
const nameLabel = document.querySelector<HTMLElement>('#remove-dialog-name')!
const input = document.querySelector<HTMLInputElement>('#remove-dialog-input')!
const cancel = document.querySelector<HTMLButtonElement>('#remove-dialog-cancel')!
const confirm = document.querySelector<HTMLButtonElement>('#remove-dialog-confirm')!

export function setupRemoveDialog(): void {
  input.addEventListener('input', () => {
    confirm.disabled = input.value !== nameLabel.textContent
  })
  cancel.addEventListener('click', () => dialog.close())
}

/** Abre el diálogo y resuelve true solo si el docente confirmó con el nombre exacto. */
export function confirmRemoval(name: string): Promise<boolean> {
  title.textContent = `¿Eliminar ${name}?`
  nameLabel.textContent = name
  input.value = ''
  confirm.disabled = true
  // Esc y el clic afuera no fijan un valor: sin esto valdría la respuesta anterior.
  dialog.returnValue = ''
  dialog.showModal()
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'remove'), { once: true })
  })
}
