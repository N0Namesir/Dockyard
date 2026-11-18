// Lista editable de contactos de la ficha: una fila por estudiante, hasta 8.
import type { Contact } from '../projects/types.ts'
import { editor } from './dom.ts'

const MAX_CONTACTS = 8

function rows(): HTMLLIElement[] {
  return [...editor.contacts.querySelectorAll<HTMLLIElement>('.contact-row')]
}

function input(row: HTMLElement, key: 'name' | 'email' | 'phone'): HTMLInputElement {
  return row.querySelector<HTMLInputElement>(`[data-contact="${key}"]`)!
}

function updateAddButton(): void {
  editor.addContact.disabled = rows().length >= MAX_CONTACTS
}

function addRow(contact: Partial<Contact> = {}): HTMLLIElement {
  const row = editor.contactTemplate.content.firstElementChild!.cloneNode(true) as HTMLLIElement
  input(row, 'name').value = contact.name ?? ''
  input(row, 'email').value = contact.email ?? ''
  input(row, 'phone').value = contact.phone ?? ''
  row.querySelector('[data-contact="remove"]')!.addEventListener('click', () => {
    const next = row.nextElementSibling ?? row.previousElementSibling
    row.remove()
    updateAddButton()
    ;(next?.querySelector<HTMLElement>('input') ?? editor.addContact).focus()
  })
  editor.contacts.append(row)
  updateAddButton()
  return row
}

export function setupContacts(): void {
  editor.addContact.addEventListener('click', () => input(addRow(), 'name').focus())
}

export function setContacts(contacts: Contact[]): void {
  editor.contacts.replaceChildren()
  contacts.forEach((contact) => addRow(contact))
}

/** Los contactos del formulario; las filas vacías se ignoran. Lanza un error si a una le falta el nombre. */
export function readContacts(): Contact[] {
  const result: Contact[] = []
  for (const row of rows()) {
    const name = input(row, 'name').value.trim()
    const email = input(row, 'email').value.trim()
    const phone = input(row, 'phone').value.trim()
    if (!name && !email && !phone) continue
    if (!name) {
      input(row, 'name').focus()
      throw new Error('Cada contacto necesita un nombre.')
    }
    if (email && !input(row, 'email').checkValidity()) {
      input(row, 'email').focus()
      throw new Error(`El correo de ${name} no es válido.`)
    }
    result.push({ name, ...(email ? { email } : {}), ...(phone ? { phone } : {}) })
  }
  return result
}
