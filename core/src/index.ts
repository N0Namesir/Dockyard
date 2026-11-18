// Contrato público del núcleo (Área 1). La API importa solo desde aquí.
// Toda falla se lanza como Error con un mensaje en español listo para mostrarse al docente.

export { normalizeProjectName } from './name.ts'
export { prepareProject, replaceProjectZip, updateProject } from './sources.ts'
export { reviewProject } from './review.ts'
export { startProject, stopProject, getProjectStatus, getProjectStatuses, getProjectLogs, removeProject, renameProject, resetProjectData } from './docker.ts'
export { getResources } from './resources.ts'
export { getLatestVersion, isNewerVersion } from './version.ts'
export { projectsDir } from './paths.ts'
export { getSelfUpdateStatus, startSelfUpdate, SELF_UPDATE_EXIT_CODE, SELF_UPDATE_LOG } from './self-update.ts'
export { PortConflictError } from './types.ts'
export type { ProjectState, ProjectStatus, ProjectSource, PreparedProject, PrepareOptions, PrepareProgress, ProjectResources, ProjectUpdate, ResourceUsage, ServiceResources, StartOptions, StartProgress, ZipReplacement } from './types.ts'
