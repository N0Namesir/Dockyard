// Contrato público del núcleo (Área 1). La API importa solo desde aquí.
// Toda falla se lanza como Error con un mensaje en español listo para mostrarse al docente.

export { normalizeProjectName } from './name.ts'
export { prepareProject, updateProject } from './sources.ts'
export { reviewProject } from './review.ts'
export { startProject, stopProject, getProjectStatus, getProjectLogs, removeProject } from './docker.ts'
export { getResources } from './resources.ts'
export { projectsDir } from './paths.ts'
export type { ProjectState, ProjectStatus, ProjectSource, PreparedProject, ProjectResources, ProjectUpdate, ResourceUsage, ServiceResources, StartOptions, StartProgress } from './types.ts'
