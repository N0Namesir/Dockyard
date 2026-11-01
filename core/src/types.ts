// Tipos del contrato entre el núcleo (Área 1) y la API (Área 2).
// No cambian sin acuerdo entre los responsables de las dos áreas.

export type ProjectState = 'running' | 'stopped'

export interface ProjectStatus {
  state: ProjectState
  /** Puertos publicados en el anfitrión, sin repetidos y ordenados. */
  ports: number[]
}

export type ProjectSource =
  | { type: 'git'; url: string }
  | { type: 'zip'; filePath: string }

export interface PreparedProject {
  /** Carpeta que contiene el archivo compose. Es la que se pasa a startProject y stopProject. */
  dir: string
  /** Nombre normalizado, válido para docker compose. */
  name: string
}
