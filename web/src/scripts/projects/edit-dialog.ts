// "Editar": corrige el equipo o el nombre de un proyecto sin eliminarlo, y guarda sus notas. La API normaliza el
// nombre y decide si se puede cambiar; aquí solo se envía lo que el docente cambió.
import { api, messageOf } from './api.ts'
import { showGlobalMessage } from './dom.ts'
import { replaceProject, state } from './state.ts'
import { render } from './table.ts'
import type { Project } from './types.ts'

const dialog = document.querySelector<HTMLDialogElement>('#edit-dialog')!
const title = document.querySelector<HTMLElement>('#edit-dialog-title')!
const form = document.querySelector<HTMLFormElement>('#edit-form')!
const team = form.querySelector<HTMLInputElement>('input[name="team"]')!
const name = form.querySelector<HTMLInputElement>('input[name="name"]')!
const notes = form.querySelector<HTMLTextAreaElement>('textarea[name="notes"]')!
const nameHint = document.querySelector<HTMLElement>('#edit-dialog-name-hint')!
const error = document.querySelector<HTMLElement>('#edit-dialog-error')!
const cancel = document.querySelector<HTMLButtonElement>('#edit-dialog-cancel')!
const save = document.querySelector<HTMLButtonElement>('#edit-dialog-save')!

/** Proyecto abierto en el diálogo. */
let editing: Project | null = null
let saving = false

function showError(message: string): void {
  error.textContent = message
  error.classList.remove('hidden')
}

export function setupEditDialog(): void {
  cancel.addEventListener('click', () => dialog.close())
  // Mientras guarda no se cierra: el resultado debe llegar a la lista.
  dialog.addEventListener('cancel', (event) => {
    if (saving) event.preventDefault()
  })
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    void submit()
  })
}

export function editProject(project: Project): void {
  if (state.pendingActions.has(project.id)) return
  editing = project
  title.textContent = `Editar ${project.name}`
  team.value = project.team
  name.value = project.name
  notes.value = project.notes
  // El nombre también es el de sus contenedores y su carpeta: solo cambia con el proyecto apagado.
  name.disabled = project.state === 'running'
  nameHint.textContent = project.state === 'running'
    ? 'Apaga el proyecto para cambiar el nombre.'
    : 'Se ajusta a minúsculas y guiones, como al registrar. Si el proyecto guarda datos en volúmenes de Docker, no se puede cambiar.'
  error.classList.add('hidden')
  save.disabled = false
  save.textContent = 'Guardar'
  dialog.showModal()
}

async function submit(): Promise<void> {
  const project = editing
  if (!project || saving) return
  const changes: { team?: string; name?: string; notes?: string } = {}
  if (team.value.trim() !== project.team) changes.team = team.value.trim()
  if (!name.disabled && name.value.trim() !== project.name) changes.name = name.value.trim()
  if (notes.value.trim() !== project.notes) changes.notes = notes.value.trim()
  if (changes.team === '' || changes.name === '') {
    showError('El equipo y el nombre no pueden quedar vacíos.')
    return
  }
  if (Object.keys(changes).length === 0) {
    dialog.close()
    return
  }

  saving = true
  save.disabled = true
  save.textContent = 'Guardando…'
  error.classList.add('hidden')
  state.pendingActions.set(project.id, 'edit')
  render()
  try {
    const updated = await api<Project>(`/api/projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    })
    replaceProject(updated)
    dialog.close()
    if (updated.name !== project.name) {
      showGlobalMessage(`${project.name} ahora se llama ${updated.name}. El próximo encendido reconstruye sus imágenes.`, 'success')
    } else {
      showGlobalMessage(`Se guardaron los cambios de ${updated.name}.`, 'success')
    }
  } catch (failure) {
    showError(messageOf(failure, 'No se pudieron guardar los cambios.'))
    save.disabled = false
    save.textContent = 'Guardar'
  } finally {
    saving = false
    state.pendingActions.delete(project.id)
    render()
  }
}
