// Pestañas Uno | Varios del panel de registro.
const one = document.querySelector<HTMLButtonElement>('#tab-one')!
const many = document.querySelector<HTMLButtonElement>('#tab-many')!
const oneForm = document.querySelector<HTMLElement>('#register-form')!
const manyPanel = document.querySelector<HTMLElement>('#register-many')!

function select(tab: HTMLButtonElement, onMany: () => void): void {
  const isMany = tab === many
  one.setAttribute('aria-selected', String(!isMany))
  many.setAttribute('aria-selected', String(isMany))
  one.tabIndex = isMany ? -1 : 0
  many.tabIndex = isMany ? 0 : -1
  oneForm.hidden = isMany
  manyPanel.hidden = !isMany
  if (isMany) onMany()
}

/** onMany se llama al abrir Varios: es cuando hace falta saber qué nombres ya existen. */
export function setupRegisterTabs(onMany: () => void): void {
  one.addEventListener('click', () => select(one, onMany))
  many.addEventListener('click', () => select(many, onMany))
  // Flechas entre pestañas, como en cualquier grupo de pestañas.
  for (const tab of [one, many]) {
    tab.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const other = tab === one ? many : one
      select(other, onMany)
      other.focus()
    })
  }
}
