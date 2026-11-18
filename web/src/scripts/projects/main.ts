// Punto de entrada de la página de proyectos: conecta los módulos y programa los refrescos.
// Para agregar un botón a la fila: la acción va en actions.ts, el botón en rows/project-row.ts y
// la conexión en RowHandlers (types.ts) y aquí.
import { changeState, removeProject, replaceConflicting, updateProject } from './actions.ts'
import { setupConfirmDialog } from './confirm-dialog.ts'
import { editProject, setupEditDialog } from './edit-dialog.ts'
import { page } from './dom.ts'
import { loadProjects } from './list.ts'
import { loadLogs, pollLogs, toggleLogs } from './logs.ts'
import { pollProgress } from './progress.ts'
import { dismissRegistration, loadRegistrations, pollRegistrations } from './registrations.ts'
import { setupRegisterForm } from './register-form.ts'
import { setupRemoveDialog } from './remove-dialog.ts'
import { replaceZip } from './replace-zip.ts'
import { pollResources } from './resources.ts'
import { state } from './state.ts'
import { stopAll } from './stop-all.ts'
import { render, setRowHandlers } from './table.ts'
import { pollVersion } from './version.ts'

const REFRESH_INTERVAL_MS = 15_000
const PROGRESS_INTERVAL_MS = 2_000
const REGISTRATIONS_INTERVAL_MS = 1_500
const LOGS_INTERVAL_MS = 3_000
const RESOURCES_INTERVAL_MS = 10_000
const VERSION_INTERVAL_MS = 60 * 60 * 1000
const SEARCH_DELAY_MS = 300

setRowHandlers({
  changeState: (project) => void changeState(project),
  updateProject: (project) => void updateProject(project),
  replaceZip: (project) => void replaceZip(project),
  editProject: (project) => editProject(project),
  removeProject: (project) => void removeProject(project),
  replaceConflicting: (project) => void replaceConflicting(project),
  toggleLogs: (project) => void toggleLogs(project),
  loadLogs: (project) => void loadLogs(project),
}, (registration) => void dismissRegistration(registration))
setupRemoveDialog()
setupConfirmDialog()
setupEditDialog()
page.stopAll.addEventListener('click', () => void stopAll())
setupRegisterForm()

let searchTimer: ReturnType<typeof setTimeout> | undefined
page.searchInput.addEventListener('input', () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void loadProjects(), SEARCH_DELAY_MS)
})

// Mantiene al día el estado de los proyectos, por ejemplo si uno se cae solo.
function refresh(): void {
  if (!document.hidden && !state.loading) void loadProjects(true)
  // También los registros de otra pestaña, que esta no sabe que empezaron.
  if (!document.hidden) void loadRegistrations()
}
setInterval(refresh, REFRESH_INTERVAL_MS)
setInterval(() => void pollProgress(), PROGRESS_INTERVAL_MS)
setInterval(pollRegistrations, REGISTRATIONS_INTERVAL_MS)
setInterval(() => void pollLogs(), LOGS_INTERVAL_MS)
setInterval(() => void pollResources(), RESOURCES_INTERVAL_MS)
setInterval(() => void pollVersion(), VERSION_INTERVAL_MS)
document.addEventListener('visibilitychange', refresh)

render()
void loadProjects().then(() => pollResources())
void loadRegistrations()
void pollVersion()
