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
    created_at TEXT NOT NULL
  ) STRICT;
`

export interface ProjectRepository {
  list(query?: string): ProjectRow[]
  findById(id: number): ProjectRow | undefined
  findByName(name: string): ProjectRow | undefined
  insert(project: NewProjectRow): ProjectRow
  close(): void
}

export function defaultDatabasePath(): string {
  const dataDir = process.env.DATA_DIR
    ? resolve(process.env.DATA_DIR)
    : resolve(import.meta.dirname, '../../../data')
  return resolve(dataDir, 'app.db')
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

  const listAll = db.prepare(`
    SELECT id, name, team, source_type, source, dir, created_at
    FROM projects
    ORDER BY created_at DESC, id DESC
  `)
  const search = db.prepare(`
    SELECT id, name, team, source_type, source, dir, created_at
    FROM projects
    WHERE name LIKE ? OR team LIKE ?
    ORDER BY created_at DESC, id DESC
  `)
  const byId = db.prepare(`
    SELECT id, name, team, source_type, source, dir, created_at
    FROM projects
    WHERE id = ?
  `)
  const byName = db.prepare(`
    SELECT id, name, team, source_type, source, dir, created_at
    FROM projects
    WHERE name = ?
  `)
  const insert = db.prepare(`
    INSERT INTO projects (name, team, source_type, source, dir, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  return {
    list(query) {
      const trimmed = query?.trim()
      if (!trimmed) return listAll.all() as unknown as ProjectRow[]
      const pattern = `%${trimmed}%`
      return search.all(pattern, pattern) as unknown as ProjectRow[]
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
      )
      const row = byId.get(Number(result.lastInsertRowid)) as unknown as
        | ProjectRow
        | undefined
      if (!row) throw new Error('No se pudo leer el proyecto recién registrado.')
      return row
    },

    close() {
      db.close()
    },
  }
}
