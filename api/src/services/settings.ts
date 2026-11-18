import type { ProjectRepository } from '../db/projects.ts'
import { updateCheckFromEnv } from './version.ts'

export type ProjectsView = 'table' | 'grid'

/** Lo que el docente puede cambiar en Configuración. Se guarda en la tabla settings. */
export interface Settings {
  /** Buscar versiones nuevas en GitHub sin que nadie lo pida (como máximo cada 6 horas). */
  updateCheck: boolean
  /** Cómo se ven los proyectos: en tabla o en cuadrícula. Es la misma en cualquier navegador. */
  projectsView: ProjectsView
}

export interface SettingsStore {
  get(): Settings
  update(changes: Partial<Settings>): Settings
}

export function createSettingsStore(repository: ProjectRepository): SettingsStore {
  // Se fija la primera vez: quien ya tenía proyectos sigue con la tabla que conoce; una instalación
  // nueva empieza con la cuadrícula. Guardarlo evita que cambie al registrar el primer proyecto.
  if (repository.getSetting('projects_view') === undefined) {
    repository.setSetting('projects_view', repository.list().length > 0 ? 'table' : 'grid')
  }

  return {
    get() {
      const updateCheck = repository.getSetting('update_check')
      return {
        // Mientras el docente no lo cambie, manda UPDATE_CHECK de .env.
        updateCheck: updateCheck === undefined ? updateCheckFromEnv() : updateCheck === 'on',
        projectsView: repository.getSetting('projects_view') === 'table' ? 'table' : 'grid',
      }
    },

    update(changes) {
      if (changes.updateCheck !== undefined) {
        repository.setSetting('update_check', changes.updateCheck ? 'on' : 'off')
      }
      if (changes.projectsView !== undefined) {
        repository.setSetting('projects_view', changes.projectsView)
      }
      return this.get()
    },
  }
}
