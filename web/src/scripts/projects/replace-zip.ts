// "Reemplazar ZIP": cambia el código de un proyecto registrado desde un ZIP por el de una entrega
// corregida, sin perder su nombre, su equipo ni sus volúmenes de Docker. La API decide si se puede.
import { api } from './api.ts'
import { showGlobalMessage } from './dom.ts'
import { confirmWithName } from './remove-dialog.ts'
import { runAction } from './run-action.ts'
import { replaceProject, state } from './state.ts'
import type { Project, ReplaceResult } from './types.ts'

/** Abre el selector de archivos y resuelve el ZIP elegido, o null si el docente cancela. */
function pickZip(): Promise<File | null> {
  const picker = document.createElement('input')
  picker.type = 'file'
  picker.accept = '.zip,application/zip'
  return new Promise((resolve) => {
    picker.addEventListener('change', () => resolve(picker.files?.[0] ?? null), { once: true })
    picker.addEventListener('cancel', () => resolve(null), { once: true })
    picker.click()
  })
}

export async function replaceZip(project: Project): Promise<void> {
  if (state.pendingActions.has(project.id)) return
  const file = await pickZip()
  if (!file) return
  const confirmed = await confirmWithName(project.name, {
    title: `¿Reemplazar el ZIP de ${project.name}?`,
    text: `Todo su código se cambia por el de ${file.name}. Se conservan el nombre, el equipo y los volúmenes de Docker, como una base de datos con volumen propio. Lo que el proyecto guardó dentro de su carpeta se borra y no se puede recuperar.`,
    confirmLabel: 'Reemplazar ZIP',
  })
  if (!confirmed) return

  await runAction(project, 'replace', async () => {
    const body = new FormData()
    body.append('file', file)
    const { project: updated, leftover } =
      await api<ReplaceResult>(`/api/projects/${project.id}/replace`, { method: 'POST', body })
    replaceProject(updated)
    const total = updated.warnings.length
    const parts = [
      total > 0
        ? `Se reemplazó el ZIP de ${updated.name}. La versión nueva tiene ${total} ${total === 1 ? 'aviso' : 'avisos'}: revísalos antes de encender.`
        : `Se reemplazó el ZIP de ${updated.name}. Enciéndelo para ver los cambios.`,
    ]
    if (leftover) parts.push(`La versión anterior quedó en ${leftover} porque tiene archivos de root. Para liberar espacio, ejecuta en una terminal: sudo rm -rf ${leftover}`)
    showGlobalMessage(parts.join(' '), total > 0 || leftover ? 'warning' : 'success')
  }, 'No se pudo reemplazar el ZIP.')
}
