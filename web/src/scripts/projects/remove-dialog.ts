// Acciones que no se pueden deshacer, como eliminar o reemplazar el ZIP: el botón solo se habilita
// al escribir el nombre exacto del proyecto.

const dialog = document.querySelector<HTMLDialogElement>('#remove-dialog')!
const title = document.querySelector<HTMLElement>('#remove-dialog-title')!
const text = document.querySelector<HTMLElement>('#remove-dialog-text')!
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

export interface DestructiveConfirmation {
  title: string
  text: string
  /** Texto del botón rojo: dice lo que va a pasar. */
  confirmLabel: string
}

/** Abre el diálogo y resuelve true solo si el docente confirmó con el nombre exacto. */
export function confirmWithName(name: string, confirmation: DestructiveConfirmation): Promise<boolean> {
  title.textContent = confirmation.title
  text.textContent = confirmation.text
  confirm.textContent = confirmation.confirmLabel
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

export function confirmRemoval(name: string): Promise<boolean> {
  return confirmWithName(name, {
    title: `¿Eliminar ${name}?`,
    text: 'Se borran sus contenedores, su código y sus datos. No se puede deshacer.',
    confirmLabel: 'Eliminar proyecto',
  })
}
