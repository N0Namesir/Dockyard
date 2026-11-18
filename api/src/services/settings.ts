import type { ProjectRepository } from '../db/projects.ts'
import { updateCheckFromEnv } from './version.ts'

/** Lo que el docente puede cambiar en Configuración. Se guarda en la tabla settings. */
export interface Settings {
  /** Buscar versiones nuevas en GitHub sin que nadie lo pida (como máximo cada 6 horas). */
  updateCheck: boolean
}

export interface SettingsStore {
  get(): Settings
  update(changes: Partial<Settings>): Settings
}

export function createSettingsStore(repository: ProjectRepository): SettingsStore {
  return {
    get() {
      const updateCheck = repository.getSetting('update_check')
      // Mientras el docente no lo cambie, manda UPDATE_CHECK de .env.
      return { updateCheck: updateCheck === undefined ? updateCheckFromEnv() : updateCheck === 'on' }
    },

    update(changes) {
      if (changes.updateCheck !== undefined) {
        repository.setSetting('update_check', changes.updateCheck ? 'on' : 'off')
      }
      return this.get()
    },
  }
}
