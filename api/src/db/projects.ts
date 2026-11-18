import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Contact, NewProjectRow, ProjectRow } from '../types.ts'

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
    notes TEXT NOT NULL DEFAULT '',
    display_name TEXT NOT NULL DEFAULT '',
    year INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL DEFAULT '',
    instructions TEXT NOT NULL DEFAULT '',
    contacts TEXT NOT NULL DEFAULT '[]',
    image TEXT,
    image_version INTEGER NOT NULL DEFAULT 0
  ) STRICT;
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT;
  -- Fichas importadas de proyectos de ZIP: esperan que el docente elija su archivo.
  CREATE TABLE IF NOT EXISTS pending_imports (
    name TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;
`

const COLUMNS = 'id, name, team, source_type, source, dir, created_at, warnings, needs_build, keep_running, notes, display_name, year, description, instructions, contacts, image, image_version'

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

/** Campos de la ficha que el docente puede cambiar sin tocar Docker. */
export interface ProjectDetails {
  displayName?: string
  year?: number
  description?: string
  instructions?: string
  contacts?: Contact[]
}

export interface ProjectRepository {
  /** Con year, solo los de ese año. */
  list(query?: string, year?: number): ProjectRow[]
  /** Años con proyectos y cuántos tiene cada uno, el más reciente primero. */
  years(): { year: number; count: number }[]
  findById(id: number): ProjectRow | undefined
  findByName(name: string): ProjectRow | undefined
  insert(project: NewProjectRow): ProjectRow
  /** Código nuevo: guarda la carpeta, los avisos y, si cambió, el origen. El próximo encendido reconstruye. */
  applyUpdate(id: number, update: { dir: string; warnings: string[]; source?: string }): void
  clearNeedsBuild(id: number): void
  setTeam(id: number, team: string): void
  setNotes(id: number, notes: string): void
  setDetails(id: number, details: ProjectDetails): void
  /** Archivo de la imagen en data/imagenes, o null. Cambia la versión para que el navegador la recargue. */
  setImage(id: number, image: string | null): void
  /** Nombre y carpeta nuevos tras renombrarlo en el núcleo. El próximo encendido reconstruye. */
  rename(id: number, project: { name: string; dir: string }): void
  /** Si el docente lo dejó encendido: Dockyard lo vuelve a encender al arrancar. */
  setKeepRunning(id: number, keepRunning: boolean): void
  delete(id: number): void
  /** Fichas importadas que esperan su ZIP, como JSON, la más antigua primero. */
  listPending(): { name: string; data: string }[]
  getPending(name: string): string | undefined
  savePending(name: string, data: string): void
  deletePending(name: string): void
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
  // Ficha: los proyectos anteriores se muestran con su nombre y el año en que se registraron.
  if (!columns.some((column) => column.name === 'display_name')) {
    db.exec("ALTER TABLE projects ADD COLUMN display_name TEXT NOT NULL DEFAULT ''")
    db.exec("UPDATE projects SET display_name = name WHERE display_name = ''")
  }
  if (!columns.some((column) => column.name === 'year')) {
    db.exec('ALTER TABLE projects ADD COLUMN year INTEGER NOT NULL DEFAULT 0')
    db.exec('UPDATE projects SET year = CAST(substr(created_at, 1, 4) AS INTEGER) WHERE year = 0')
  }
  if (!columns.some((column) => column.name === 'description')) {
    db.exec("ALTER TABLE projects ADD COLUMN description TEXT NOT NULL DEFAULT ''")
  }
  if (!columns.some((column) => column.name === 'instructions')) {
    db.exec("ALTER TABLE projects ADD COLUMN instructions TEXT NOT NULL DEFAULT ''")
  }
  if (!columns.some((column) => column.name === 'contacts')) {
    db.exec("ALTER TABLE projects ADD COLUMN contacts TEXT NOT NULL DEFAULT '[]'")
  }
  if (!columns.some((column) => column.name === 'image')) {
    db.exec('ALTER TABLE projects ADD COLUMN image TEXT')
  }
  if (!columns.some((column) => column.name === 'image_version')) {
    db.exec('ALTER TABLE projects ADD COLUMN image_version INTEGER NOT NULL DEFAULT 0')
  }
  db.function('normalizar', { deterministic: true }, (value) =>
    normalizeForSearch(String(value)),
  )

  // Un año 0 es «todos»: así una sola consulta sirve con y sin carpeta.
  const listAll = db.prepare(`
    SELECT ${COLUMNS}
    FROM projects
    WHERE (? = 0 OR year = ?)
    ORDER BY created_at DESC, id DESC
  `)
  const search = db.prepare(`
    SELECT ${COLUMNS}
    FROM projects
    WHERE (? = 0 OR year = ?)
      AND (normalizar(name) LIKE ? ESCAPE '\\' OR normalizar(team) LIKE ? ESCAPE '\\'
        OR normalizar(display_name) LIKE ? ESCAPE '\\' OR normalizar(description) LIKE ? ESCAPE '\\')
    ORDER BY created_at DESC, id DESC
  `)
  const yearCounts = db.prepare('SELECT year, COUNT(*) AS count FROM projects GROUP BY year ORDER BY year DESC')
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
    INSERT INTO projects (name, team, source_type, source, dir, created_at, warnings, display_name, year)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const update = db.prepare('UPDATE projects SET dir = ?, warnings = ?, source = COALESCE(?, source), needs_build = 1 WHERE id = ?')
  const built = db.prepare('UPDATE projects SET needs_build = 0 WHERE id = ?')
  const team = db.prepare('UPDATE projects SET team = ? WHERE id = ?')
  const notes = db.prepare('UPDATE projects SET notes = ? WHERE id = ?')
  // COALESCE: un campo que no llega queda como estaba.
  const details = db.prepare(`
    UPDATE projects SET
      display_name = COALESCE(?, display_name),
      year = COALESCE(?, year),
      description = COALESCE(?, description),
      instructions = COALESCE(?, instructions),
      contacts = COALESCE(?, contacts)
    WHERE id = ?
  `)
  const image = db.prepare('UPDATE projects SET image = ?, image_version = image_version + 1 WHERE id = ?')
  const rename = db.prepare('UPDATE projects SET name = ?, dir = ?, needs_build = 1 WHERE id = ?')
  const keepRunning = db.prepare('UPDATE projects SET keep_running = ? WHERE id = ?')
  const remove = db.prepare('DELETE FROM projects WHERE id = ?')
  const pendingAll = db.prepare('SELECT name, data FROM pending_imports ORDER BY created_at, name')
  const pendingOne = db.prepare('SELECT data FROM pending_imports WHERE name = ?')
  const pendingSave = db.prepare('INSERT INTO pending_imports (name, data, created_at) VALUES (?, ?, ?) ON CONFLICT (name) DO UPDATE SET data = excluded.data')
  const pendingDelete = db.prepare('DELETE FROM pending_imports WHERE name = ?')
  const readSetting = db.prepare('SELECT value FROM settings WHERE key = ?')
  const writeSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')

  return {
    list(query, year = 0) {
      const trimmed = query?.trim()
      if (!trimmed) return listAll.all(year, year) as unknown as ProjectRow[]
      const text = normalizeForSearch(trimmed)
      // El nombre guardado lleva guiones: "tienda escolar" también debe encontrar "tienda-escolar".
      const byName = likePattern(text.replace(/\s+/g, '-'))
      const words = likePattern(text)
      return search.all(year, year, byName, words, words, words) as unknown as ProjectRow[]
    },

    years() {
      return (yearCounts.all() as unknown as { year: number; count: number }[])
        .map(({ year, count }) => ({ year, count }))
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
        project.displayName ?? project.name,
        project.year ?? new Date().getFullYear(),
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

    setDetails(id, value) {
      details.run(
        value.displayName ?? null,
        value.year ?? null,
        value.description ?? null,
        value.instructions ?? null,
        value.contacts === undefined ? null : JSON.stringify(value.contacts),
        id,
      )
    },

    setImage(id, value) {
      image.run(value, id)
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

    listPending() {
      return (pendingAll.all() as unknown as { name: string; data: string }[]).map(({ name, data }) => ({ name, data }))
    },

    getPending(name) {
      return (pendingOne.get(name) as { data: string } | undefined)?.data
    },

    savePending(name, data) {
      pendingSave.run(name, data, new Date().toISOString())
    },

    deletePending(name) {
      pendingDelete.run(name)
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
