import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { NewProjectRow, ProjectRow } from '../types.ts'

const schema = `
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    team TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('git', 'zip')),
    source TEXT NOT NULL,
    dir TEXT NOT NULL,
    created_at TEXT NOT NULL,
    warnings TEXT NOT NULL DEFAULT '[]',
    needs_build INTEGER NOT NULL DEFAULT 0,
    keep_running INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT ''
  ) STRICT;
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT;
`

const COLUMNS = 'id, name, team, source_type, source, dir, created_at, warnings, needs_build, keep_running, notes'

/** Minúsculas y sin tildes: LIKE de SQLite solo ignora mayúsculas en letras sin acento. */
function normalizeForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/** Patrón para LIKE que trata %, _ y \\ como texto normal. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, '\\$&')}%`
}

export interface ProjectRepository {
  list(query?: string): ProjectRow[]
  findById(id: number): ProjectRow | undefined
  findByName(name: string): ProjectRow | undefined
  insert(project: NewProjectRow): ProjectRow
  /** Código nuevo: guarda la carpeta, los avisos y, si cambió, el origen. El próximo encendido reconstruye. */
  applyUpdate(id: number, update: { dir: string; warnings: string[]; source?: string }): void
  clearNeedsBuild(id: number): void
  setTeam(id: number, team: string): void
  setNotes(id: number, notes: string): void
  /** Nombre y carpeta nuevos tras renombrarlo en el núcleo. El próximo encendido reconstruye. */
  rename(id: number, project: { name: string; dir: string }): void
  /** Si el docente lo dejó encendido: Dockyard lo vuelve a encender al arrancar. */
  setKeepRunning(id: number, keepRunning: boolean): void
  delete(id: number): void
  /** Ajuste de Configuración; undefined si el docente nunca lo cambió. */
  getSetting(key: string): string | undefined
  setSetting(key: string, value: string): void
  close(): void
}

/** Carpeta de datos de Dockyard: la base y el registro de la última actualización. */
export function defaultDataDir(): string {
  return process.env.DATA_DIR
    ? resolve(process.env.DATA_DIR)
    : resolve(import.meta.dirname, '../../../data')
}

export function defaultDatabasePath(): string {
  return resolve(defaultDataDir(), 'app.db')
}

export function createProjectRepository(
  databasePath = defaultDatabasePath(),
): ProjectRepository {
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(databasePath), { recursive: true })
  }

  const db = new DatabaseSync(databasePath)
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec(schema)
  // Una base creada por una versión anterior puede no tener estas columnas.
  const columns = db.prepare('PRAGMA table_info(projects)').all() as unknown as { name: string }[]
  if (!columns.some((column) => column.name === 'warnings')) {
    db.exec("ALTER TABLE projects ADD COLUMN warnings TEXT NOT NULL DEFAULT '[]'")
  }
  if (!columns.some((column) => column.name === 'needs_build')) {
    db.exec('ALTER TABLE projects ADD COLUMN needs_build INTEGER NOT NULL DEFAULT 0')
  }
  if (!columns.some((column) => column.name === 'notes')) {
    db.exec("ALTER TABLE projects ADD COLUMN notes TEXT NOT NULL DEFAULT ''")
  }
  if (!columns.some((column) => column.name === 'keep_running')) {
    db.exec('ALTER TABLE projects ADD COLUMN keep_running INTEGER NOT NULL DEFAULT 0')
  }
  db.function('normalizar', { deterministic: true }, (value) =>
    normalizeForSearch(String(value)),
  )

  const listAll = db.prepare(`
    SELECT ${COLUMNS}
    FROM projects
    ORDER BY created_at DESC, id DESC
  `)
  const search = db.prepare(`
    SELECT ${COLUMNS}
    FROM projects
    WHERE normalizar(name) LIKE ? ESCAPE '\\' OR normalizar(team) LIKE ? ESCAPE '\\'
    ORDER BY created_at DESC, id DESC
  `)
  const byId = db.prepare(`
    SELECT ${COLUMNS}
    FROM projects
    WHERE id = ?
  `)
  const byName = db.prepare(`
    SELECT ${COLUMNS}
    FROM projects
    WHERE name = ?
  `)
  const insert = db.prepare(`
    INSERT INTO projects (name, team, source_type, source, dir, created_at, warnings)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  const update = db.prepare('UPDATE projects SET dir = ?, warnings = ?, source = COALESCE(?, source), needs_build = 1 WHERE id = ?')
  const built = db.prepare('UPDATE projects SET needs_build = 0 WHERE id = ?')
  const team = db.prepare('UPDATE projects SET team = ? WHERE id = ?')
  const notes = db.prepare('UPDATE projects SET notes = ? WHERE id = ?')
  const rename = db.prepare('UPDATE projects SET name = ?, dir = ?, needs_build = 1 WHERE id = ?')
  const keepRunning = db.prepare('UPDATE projects SET keep_running = ? WHERE id = ?')
  const remove = db.prepare('DELETE FROM projects WHERE id = ?')
  const readSetting = db.prepare('SELECT value FROM settings WHERE key = ?')
  const writeSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')

  return {
    list(query) {
      const trimmed = query?.trim()
      if (!trimmed) return listAll.all() as unknown as ProjectRow[]
      const text = normalizeForSearch(trimmed)
      // El nombre guardado lleva guiones: "tienda escolar" también debe encontrar "tienda-escolar".
      const byName = likePattern(text.replace(/\s+/g, '-'))
      return search.all(byName, likePattern(text)) as unknown as ProjectRow[]
    },

    findById(id) {
      return byId.get(id) as unknown as ProjectRow | undefined
    },

    findByName(name) {
      return byName.get(name) as unknown as ProjectRow | undefined
    },

    insert(project) {
      const createdAt = new Date().toISOString()
      const result = insert.run(
        project.name,
        project.team,
        project.sourceType,
        project.source,
        project.dir,
        createdAt,
        JSON.stringify(project.warnings),
      )
      const row = byId.get(Number(result.lastInsertRowid)) as unknown as
        | ProjectRow
        | undefined
      if (!row) throw new Error('No se pudo leer el proyecto recién registrado.')
      return row
    },

    applyUpdate(id, { dir, warnings, source }) {
      update.run(dir, JSON.stringify(warnings), source ?? null, id)
    },

    clearNeedsBuild(id) {
      built.run(id)
    },

    setTeam(id, value) {
      team.run(value, id)
    },

    setNotes(id, value) {
      notes.run(value, id)
    },

    rename(id, { name, dir }) {
      rename.run(name, dir, id)
    },

    setKeepRunning(id, value) {
      keepRunning.run(value ? 1 : 0, id)
    },

    delete(id) {
      remove.run(id)
    },

    getSetting(key) {
      const row = readSetting.get(key) as { value: string } | undefined
      return row?.value
    },

    setSetting(key, value) {
      writeSetting.run(key, value)
    },

    close() {
      db.close()
    },
  }
}
