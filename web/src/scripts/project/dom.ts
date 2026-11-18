// Elementos fijos de la página de la ficha (web/src/pages/proyecto.astro).

function required<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector)
  if (!node) throw new Error(`Falta ${selector} en la página.`)
  return node
}

export const view = {
  loading: required<HTMLElement>('#project-loading'),
  error: required<HTMLElement>('#project-error'),
  message: required<HTMLElement>('#project-message'),
  root: required<HTMLElement>('#project-view'),
  image: required<HTMLElement>('#project-image'),
  displayName: required<HTMLElement>('#project-display-name'),
  name: required<HTMLElement>('#project-name'),
  team: required<HTMLElement>('#project-team'),
  year: required<HTMLElement>('#project-year'),
  edit: required<HTMLButtonElement>('#project-edit'),
  state: required<HTMLElement>('#project-state'),
  toggle: required<HTMLButtonElement>('#project-toggle'),
  open: required<HTMLAnchorElement>('#project-open'),
  resources: required<HTMLElement>('#project-resources'),
  actionError: required<HTMLElement>('#project-action-error'),
  description: required<HTMLElement>('#project-description'),
  instructions: required<HTMLElement>('#project-instructions'),
  contacts: required<HTMLUListElement>('#project-contacts'),
  notes: required<HTMLElement>('#project-notes'),
  warningsBox: required<HTMLElement>('#project-warnings-box'),
  warnings: required<HTMLUListElement>('#project-warnings'),
}

export const editor = {
  section: required<HTMLElement>('#edit-section'),
  form: required<HTMLFormElement>('#edit-form'),
  nameHint: required<HTMLElement>('#edit-name-hint'),
  contacts: required<HTMLOListElement>('#contacts-list'),
  addContact: required<HTMLButtonElement>('#add-contact'),
  contactTemplate: required<HTMLTemplateElement>('#contact-template'),
  imagePreview: required<HTMLElement>('#edit-image-preview'),
  removeImage: required<HTMLButtonElement>('#remove-image'),
  error: required<HTMLElement>('#edit-error'),
  cancel: required<HTMLButtonElement>('#edit-cancel'),
  save: required<HTMLButtonElement>('#edit-save'),
}

/** Un campo del formulario de edición por su nombre. */
export function field<T extends HTMLInputElement | HTMLTextAreaElement = HTMLInputElement>(name: string): T {
  return editor.form.elements.namedItem(name) as T
}

export function showMessage(text: string | null): void {
  view.message.textContent = text ?? ''
  view.message.classList.toggle('hidden', !text)
}
