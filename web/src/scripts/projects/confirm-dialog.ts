// Confirmación para acciones que se pueden deshacer, como apagar: basta un clic, sin escribir el
// nombre. Eliminar usa remove-dialog.ts, que sí lo exige.

const dialog = document.querySelector<HTMLDialogElement>('#confirm-dialog')!
const title = document.querySelector<HTMLElement>('#confirm-dialog-title')!
const text = document.querySelector<HTMLElement>('#confirm-dialog-text')!
const cancel = document.querySelector<HTMLButtonElement>('#confirm-dialog-cancel')!
const confirm = document.querySelector<HTMLButtonElement>('#confirm-dialog-confirm')!

export interface Confirmation {
  title: string
  text: string
  /** Texto del botón que confirma: dice lo que va a pasar. */
  confirmLabel: string
}

export function setupConfirmDialog(): void {
  cancel.addEventListener('click', () => dialog.close())
}

/** Abre el diálogo y resuelve true solo si el docente confirmó. */
export function confirmAction(confirmation: Confirmation): Promise<boolean> {
  title.textContent = confirmation.title
  text.textContent = confirmation.text
  confirm.textContent = confirmation.confirmLabel
  // Esc y el clic afuera no fijan un valor: sin esto valdría la respuesta anterior.
  dialog.returnValue = ''
  dialog.showModal()
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true })
  })
}
