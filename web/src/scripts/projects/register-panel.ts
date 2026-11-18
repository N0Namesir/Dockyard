// Panel nativo: conserva el borrador al cerrar y devuelve el foco al botón de apertura.
const dialog = document.querySelector<HTMLDialogElement>('#register-dialog')!
const opener = document.querySelector<HTMLButtonElement>('#open-register')!

export function setupRegisterPanel(): void {
  opener.addEventListener('click', () => dialog.showModal())
  document.querySelector('#close-register')!.addEventListener('click', () => dialog.close())
  dialog.addEventListener('close', () => opener.focus())
}

export function registrationSubmitted(): void {
  if (document.querySelector<HTMLInputElement>('#register-another')!.checked) {
    document.querySelector<HTMLInputElement>('#register-form [name="team"]')!.focus()
  } else {
    dialog.close()
  }
}
