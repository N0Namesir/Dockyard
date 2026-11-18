// Estado de la página. Es una copia de lo que respondió la API más lo que el docente tiene
// abierto; la fuente de verdad sigue siendo la API.
import type { PortConflict, Project, ProjectAction, Registration, Resources } from './types.ts'

export const state = {
  projects: [] as Project[],
  loading: true,
  loadFailed: false,
  resources: null as Resources | null,
  /** Registros en curso y fallidos, según la API. */
  registrations: [] as Registration[],
  /** Registros que esta pestaña envió y aún no responden. */
  registering: 0,
  /** Acción que el docente lanzó desde esta pestaña y aún no termina. */
  pendingActions: new Map<number, ProjectAction>(),
  /** Error de la última acción, por proyecto. */
  actionErrors: new Map<number, string>(),
  /** Proyecto que no dejó encender a otro por un puerto: la fila ofrece apagarlo. */
  actionConflicts: new Map<number, PortConflict>(),
  /** Hay una tanda de "Apagar todos" en curso desde esta pestaña. */
  stoppingAll: false,
  /** Registros abiertos por proyecto; null mientras se cargan. */
  openLogs: new Map<number, string | null>(),
  /** Registros que el docente subió a leer, con su posición: el texto nuevo no debe moverlos. */
  logsScroll: new Map<number, number>(),
  /** Proyectos con la lista de avisos abierta: redibujar la tabla no debe cerrarla. */
  openWarnings: new Set<number>(),
}

export function isStarting(project: Project): boolean {
  return state.pendingActions.get(project.id) === 'start' || project.progress !== null
}

/** Reemplaza un proyecto de la lista por su versión nueva. */
export function replaceProject(updated: Project): void {
  state.projects = state.projects.map((item) => item.id === updated.id ? updated : item)
}
