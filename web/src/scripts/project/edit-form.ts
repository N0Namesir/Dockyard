// Edición de la ficha en la misma página: datos, contactos e imagen. La API valida y decide si el
// nombre técnico se puede cambiar; aquí solo se envía lo que el docente cambió.
import { api, messageOf } from '../projects/api.ts'
import { avatar } from '../projects/avatar.ts'
import type { Contact, Project } from '../projects/types.ts'
import { readContacts, setContacts, setupContacts } from './contacts.ts'
import { editor, field, view } from './dom.ts'

const IMAGE_MAX_BYTES = 2 * 1024 * 1024
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']

interface Changes {
  displayName?: string
  name?: string
  team?: string
  year?: number
  description?: string
  instructions?: string
  notes?: string
  contacts?: Contact[]
}

let editing: Project | null = null
/** El docente pidió quitar la imagen actual. */
let dropImage = false
let saving = false
let preview: string | null = null
let saved: (project: Project, message: string) => void = () => {}

const imageInput = () => field('image')

function showError(message: string | null): void {
  editor.error.textContent = message ?? ''
  editor.error.classList.toggle('hidden', !message)
}

function showPreview(project: Project): void {
  if (preview) URL.revokeObjectURL(preview)
  preview = null
  const file = imageInput().files?.[0]
  if (file) preview = URL.createObjectURL(file)
  const imageUrl = preview ?? (dropImage ? null : project.imageUrl)
  editor.imagePreview.replaceChildren(avatar({ ...project, imageUrl }, 'size-full text-5xl'))
  editor.removeImage.hidden = imageUrl === null
}

export function isEditing(): boolean {
  return editing !== null
}

export function openEditor(project: Project): void {
  editing = project
  dropImage = false
  field('displayName').value = project.displayName || project.name
  field('name').value = project.name
  field('team').value = project.team
  field('year').value = String(project.year)
  field<HTMLTextAreaElement>('description').value = project.description
  field<HTMLTextAreaElement>('instructions').value = project.instructions
  field<HTMLTextAreaElement>('notes').value = project.notes
  // El nombre técnico es el de sus contenedores y su carpeta: solo cambia con el proyecto apagado.
  field('name').disabled = project.state === 'running'
  editor.nameHint.textContent = project.state === 'running'
    ? 'Apaga el proyecto para cambiar el nombre técnico.'
    : 'Lo usan Docker y su carpeta. Se ajusta a minúsculas y guiones. Si el proyecto guarda datos en volúmenes de Docker, no se puede cambiar.'
  setContacts(project.contacts)
  imageInput().value = ''
  showPreview(project)
  showError(null)
  editor.save.disabled = false
  editor.save.textContent = 'Guardar'
  view.root.hidden = true
  editor.section.hidden = false
  history.replaceState(null, '', `${location.pathname}${location.search}#editar`)
  field('displayName').focus()
}

function closeEditor(): void {
  if (saving) return
  editing = null
  editor.section.hidden = true
  view.root.hidden = false
  history.replaceState(null, '', `${location.pathname}${location.search}`)
  view.edit.focus()
}

/** Lo que cambió respecto de la ficha guardada. Lanza un error con lo que hay que corregir. */
function changesFrom(project: Project): Changes {
  const text = (name: string) => field<HTMLInputElement | HTMLTextAreaElement>(name).value.trim()
  const changes: Changes = {}
  if (!text('displayName')) throw new Error('El nombre para mostrar no puede quedar vacío.')
  if (!text('team')) throw new Error('El equipo no puede quedar vacío.')
  const year = Number(text('year'))
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('El año debe estar entre 2000 y 2100.')
  if (text('displayName') !== (project.displayName || project.name)) changes.displayName = text('displayName')
  if (!field('name').disabled && text('name') !== project.name) {
    if (!text('name')) throw new Error('El nombre técnico no puede quedar vacío.')
    changes.name = text('name')
  }
  if (text('team') !== project.team) changes.team = text('team')
  if (year !== project.year) changes.year = year
  for (const key of ['description', 'instructions', 'notes'] as const) {
    if (text(key) !== project[key]) changes[key] = text(key)
  }
  const contacts = readContacts()
  if (JSON.stringify(contacts) !== JSON.stringify(project.contacts)) changes.contacts = contacts
  return changes
}

async function submit(): Promise<void> {
  const project = editing
  if (!project || saving) return
  let changes: Changes
  try {
    changes = changesFrom(project)
  } catch (error) {
    showError(messageOf(error, 'Revisa los datos de la ficha.'))
    return
  }
  const file = imageInput().files?.[0]
  const removing = dropImage && !file && project.imageUrl !== null
  if (Object.keys(changes).length === 0 && !file && !removing) {
    closeEditor()
    return
  }

  saving = true
  editor.save.disabled = true
  editor.save.textContent = 'Guardando…'
  showError(null)
  let current = project
  try {
    if (Object.keys(changes).length > 0) {
      current = await api<Project>(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      })
      editing = current
    }
    if (file) {
      const body = new FormData()
      body.append('file', file)
      current = await api<Project>(`/api/projects/${project.id}/image`, { method: 'PUT', body })
    } else if (removing) {
      current = await api<Project>(`/api/projects/${project.id}/image`, { method: 'DELETE' })
    }
  } catch (error) {
    // Lo que sí se guardó queda en la ficha; el formulario sigue abierto con el motivo.
    if (current !== project) saved(current, '')
    showError(messageOf(error, 'No se pudieron guardar los cambios.'))
    editor.save.disabled = false
    editor.save.textContent = 'Guardar'
    saving = false
    return
  }
  saving = false
  closeEditor()
  saved(current, current.name !== project.name
    ? `${project.name} ahora se llama ${current.name}. El próximo encendido reconstruye sus imágenes.`
    : 'Se guardaron los cambios de la ficha.')
}

export function setupEditForm(onSaved: (project: Project, message: string) => void): void {
  saved = onSaved
  setupContacts()
  editor.cancel.addEventListener('click', closeEditor)
  editor.form.addEventListener('submit', (event) => {
    event.preventDefault()
    void submit()
  })
  editor.form.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeEditor()
  })
  imageInput().addEventListener('change', () => {
    const file = imageInput().files?.[0]
    if (file && !IMAGE_TYPES.includes(file.type)) {
      showError('La imagen debe ser PNG, JPEG o WebP.')
      imageInput().value = ''
    } else if (file && file.size > IMAGE_MAX_BYTES) {
      showError('La imagen supera el límite de 2 MB. Usa una más pequeña.')
      imageInput().value = ''
    } else {
      showError(null)
      if (file) dropImage = false
    }
    if (editing) showPreview(editing)
  })
  editor.removeImage.addEventListener('click', () => {
    dropImage = true
    imageInput().value = ''
    if (editing) showPreview(editing)
    imageInput().focus()
  })
}
