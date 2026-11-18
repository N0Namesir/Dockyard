// Exportar e importar la lista de proyectos.
import assert from 'node:assert/strict'
import { access, mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildApp } from '../src/app.ts'
import type { ProjectStatus } from '../src/core.ts'
import { createProjectRepository } from '../src/db/projects.ts'
import type { CoreAdapter } from '../src/types.ts'

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(1_200_000)])
const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')

function fakeCore(): CoreAdapter {
  return {
    normalizeProjectName: normalize,
    async prepareProject(source, name) {
      if (source.type === 'zip') await access(source.filePath)
      return { dir: `/projects/${normalize(name)}`, name: normalize(name) }
    },
    async reviewProject() {
      return ['Servicio web: usa privileged.']
    },
    async getProjectStatus(): Promise<ProjectStatus> {
      return { state: 'stopped', ports: [] }
    },
    async getProjectStatuses() {
      return {}
    },
  } as Partial<CoreAdapter> as CoreAdapter
}

async function setup() {
  const dataDir = await mkdtemp(join(tmpdir(), 'dockyard-respaldo-'))
  const app = await buildApp({ repository: createProjectRepository(':memory:'), core: fakeCore(), checkWeb: async () => ({ state: 'ok' }), dataDir })
  return { app, dataDir }
}

function multipart(fields: Record<string, string>, file?: { name: string; field?: string; bytes: Buffer }) {
  const boundary = 'dockyard-respaldo'
  const parts: Buffer[] = Object.entries(fields).map(([key, value]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`))
  if (file) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.field ?? 'file'}"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`), file.bytes, Buffer.from('\r\n'))
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`))
  return { headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: Buffer.concat(parts) }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

/** Una PC con un proyecto de GitHub con toda su ficha e imagen, y uno de ZIP. */
async function source() {
  const { app } = await setup()
  await app.inject({ method: 'POST', url: '/api/projects', payload: { team: 'Equipo 1', name: 'Tienda', displayName: 'Tienda escolar', year: 2025, repoUrl: 'https://github.com/e/tienda' } })
  await app.inject({
    method: 'PATCH',
    url: '/api/projects/1',
    payload: { notes: 'Nota 7', description: 'Vende útiles.', instructions: 'admin / admin', contacts: [{ name: 'Ana', email: 'ana@escuela.edu' }] },
  })
  await app.inject({ method: 'PUT', url: '/api/projects/1/image', ...multipart({}, { name: 'logo.png', bytes: PNG }) })
  await app.inject({ method: 'POST', url: '/api/projects', ...multipart({ team: 'Equipo 2', name: 'Agenda', year: '2026' }, { name: 'agenda.zip', bytes: Buffer.from('zip') }) })
  return app
}

test('exportar descarga la ficha de cada proyecto, sin código, datos de Docker ni avisos', async () => {
  const app = await source()
  const response = await app.inject({ method: 'GET', url: '/api/export' })
  assert.equal(response.statusCode, 200)
  assert.match(response.headers['content-disposition'] as string, /^attachment; filename="dockyard-proyectos-\d{4}-\d{2}-\d{2}\.json"$/)
  const file = response.json()
  assert.equal(file.format, 1)
  assert.match(file.dockyard, /^\d+\.\d+\.\d+$/)
  assert.ok(!Number.isNaN(Date.parse(file.exportedAt)))
  const [tienda, agenda] = file.projects
  assert.deepEqual({ ...tienda, image: tienda.image.type }, {
    name: 'tienda', displayName: 'Tienda escolar', team: 'Equipo 1', year: 2025, sourceType: 'git',
    repoUrl: 'https://github.com/e/tienda', notes: 'Nota 7', description: 'Vende útiles.', instructions: 'admin / admin',
    contacts: [{ name: 'Ana', email: 'ana@escuela.edu' }], image: 'png',
  })
  assert.deepEqual(Buffer.from(tienda.image.data, 'base64'), PNG)
  assert.equal(agenda.sourceType, 'zip')
  assert.equal(agenda.zipName, 'agenda.zip')
  assert.equal(agenda.repoUrl, undefined)
  assert.equal(agenda.image, null)
  for (const key of ['warnings', 'dir', 'id', 'state']) assert.ok(!(key in tienda), key)
  await app.close()
})

test('importar: vista previa, registra los de GitHub con su ficha, deja los de ZIP esperando y omite los que existen', async () => {
  const exported = (await (await source()).inject({ method: 'GET', url: '/api/export' })).json()
  exported.projects.push({ ...exported.projects[0], displayName: 'Copia' })
  const { app, dataDir } = await setup()
  await app.inject({ method: 'POST', url: '/api/projects', payload: { team: 'E', name: 'ya-estaba', repoUrl: 'https://github.com/e/x' } })
  exported.projects.push({ name: 'ya-estaba', team: 'Otro', sourceType: 'git', repoUrl: 'https://github.com/o/x' })

  const preview = await app.inject({ method: 'POST', url: '/api/import/preview', payload: exported })
  assert.equal(preview.statusCode, 200, preview.body)
  assert.deepEqual(preview.json().projects.map((p: { name: string; action: string; reason: string | null }) => [p.name, p.action, p.reason]), [
    ['tienda', 'register', null],
    ['agenda', 'needs-zip', null],
    ['tienda', 'skip', 'Se repite en el archivo.'],
    ['ya-estaba', 'skip', 'Ya existe un proyecto con ese nombre.'],
  ])
  // La vista previa no cambia nada.
  assert.equal((await app.inject({ method: 'GET', url: '/api/projects' })).json().length, 1)

  const applied = (await app.inject({ method: 'POST', url: '/api/import', payload: exported })).json()
  assert.deepEqual(applied.queued, ['tienda'])
  assert.deepEqual(applied.needsZip, ['agenda'])
  assert.deepEqual(applied.skipped.map((s: { name: string }) => s.name), ['tienda', 'ya-estaba'])
  await settle()

  const tienda = (await app.inject({ method: 'GET', url: '/api/projects?q=tienda' })).json()[0]
  assert.deepEqual(
    [tienda.displayName, tienda.team, tienda.year, tienda.notes, tienda.description, tienda.instructions, tienda.contacts, tienda.warnings],
    ['Tienda escolar', 'Equipo 1', 2025, 'Nota 7', 'Vende útiles.', 'admin / admin', [{ name: 'Ana', email: 'ana@escuela.edu' }], ['Servicio web: usa privileged.']],
  )
  assert.ok(tienda.imageUrl)
  assert.deepEqual(await readdir(join(dataDir, 'imagenes')), [`${tienda.id}.png`])

  // Importar de nuevo no repite nada.
  const again = (await app.inject({ method: 'POST', url: '/api/import', payload: exported })).json()
  assert.deepEqual([again.queued, again.needsZip], [[], []])
  assert.match(again.skipped.find((s: { name: string }) => s.name === 'agenda').reason, /espera su ZIP/)

  // El de ZIP espera su archivo y se registra con su ficha.
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/import/pending' })).json(), [
    { name: 'agenda', displayName: 'Agenda', team: 'Equipo 2', year: 2026, zipName: 'agenda.zip', hasImage: false },
  ])
  const created = await app.inject({ method: 'POST', url: '/api/import/pending/agenda', ...multipart({}, { name: 'agenda-v2.zip', bytes: Buffer.from('zip') }) })
  assert.equal(created.statusCode, 201, created.body)
  assert.deepEqual([created.json().name, created.json().team, created.json().year], ['agenda', 'Equipo 2', 2026])
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/import/pending' })).json(), [])
  assert.equal((await app.inject({ method: 'POST', url: '/api/import/pending/agenda', ...multipart({}, { name: 'a.zip', bytes: Buffer.from('zip') }) })).statusCode, 404)
  await app.close()
})

test('una ficha que espera su ZIP se puede descartar', async () => {
  const { app } = await setup()
  const file = { format: 1, projects: [{ name: 'agenda', team: 'E', sourceType: 'zip' }] }
  await app.inject({ method: 'POST', url: '/api/import', payload: file })
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/import/pending/agenda' })).statusCode, 204)
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/import/pending/agenda' })).statusCode, 404)
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/import/pending' })).json(), [])
  await app.close()
})

test('un archivo que no es una lista de Dockyard no se importa', async () => {
  const { app } = await setup()
  const bad: unknown[] = [
    {},
    { format: 2, projects: [] },
    { format: 1, projects: [{ name: 'x', team: 'E', sourceType: 'svn' }] },
    { format: 1, projects: [{ name: 'x', team: 'E', sourceType: 'git', contacts: [{ name: 'A', email: 'no' }] }] },
    { format: 1, projects: [{ name: 'x', team: 'E', sourceType: 'git', image: { type: 'svg', data: 'PHN2Zz4=' } }] },
  ]
  for (const payload of bad) {
    const response = await app.inject({ method: 'POST', url: '/api/import/preview', payload: payload as object })
    assert.equal(response.statusCode, 400, JSON.stringify(payload))
    assert.match(response.json().message, /no es una lista exportada por Dockyard/)
  }
  // Una URL que no es de GitHub se omite con su motivo; una imagen que no es lo que dice se descarta.
  const result = (await app.inject({
    method: 'POST',
    url: '/api/import',
    payload: {
      format: 1,
      projects: [
        { name: 'malo', team: 'E', sourceType: 'git', repoUrl: 'https://gitlab.com/e/p' },
        { name: 'bueno', team: 'E', sourceType: 'git', repoUrl: 'https://github.com/e/p', image: { type: 'png', data: Buffer.from('no es png').toString('base64') } },
      ],
    },
  })).json()
  assert.deepEqual(result.queued, ['bueno'])
  assert.match(result.skipped[0].reason, /HTTPS de GitHub/)
  await settle()
  assert.equal((await app.inject({ method: 'GET', url: '/api/projects' })).json()[0].imageUrl, null)
  await app.close()
})
