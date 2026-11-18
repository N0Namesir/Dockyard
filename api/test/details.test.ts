// Ficha enriquecida: nombre para mostrar, año, descripción, indicaciones, contactos e imagen.
import assert from 'node:assert/strict'
import { access, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { buildApp } from '../src/app.ts'
import type { ProjectStatus } from '../src/core.ts'
import { createProjectRepository } from '../src/db/projects.ts'
import { imageTypeOf } from '../src/services/images.ts'
import type { CoreAdapter } from '../src/types.ts'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')])
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')

function fakeCore(): CoreAdapter {
  const statuses = new Map<string, ProjectStatus>()
  const normalize = (name: string) => name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return {
    normalizeProjectName: normalize,
    async prepareProject(_source, name) {
      return { dir: `/projects/${normalize(name)}`, name: normalize(name) }
    },
    async reviewProject() {
      return []
    },
    async getProjectStatus(name) {
      return statuses.get(name) ?? { state: 'stopped', ports: [] }
    },
    async getProjectStatuses() {
      return Object.fromEntries(statuses)
    },
    async removeProject() {},
    async renameProject(_name, newName) {
      return { dir: `/projects/${newName}`, name: newName }
    },
  } as Partial<CoreAdapter> as CoreAdapter
}

async function setup() {
  const dataDir = await mkdtemp(join(tmpdir(), 'dockyard-ficha-'))
  const app = await buildApp({ repository: createProjectRepository(':memory:'), core: fakeCore(), checkWeb: async () => ({ state: 'ok' }), dataDir })
  const register = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/projects', payload: { team: 'E', repoUrl: 'https://github.com/e/p', ...payload } })
  const patch = (id: number, payload: unknown) => app.inject({ method: 'PATCH', url: `/api/projects/${id}`, payload: payload as object })
  return { app, dataDir, register, patch }
}

function imageUpload(bytes: Buffer, filename = 'logo.png') {
  const boundary = 'dockyard-imagen'
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  }
}

test('al registrar, el nombre para mostrar es el que escribió el docente y el año el actual', async () => {
  const { app, register } = await setup()
  const created = (await register({ name: 'Tienda Escolar' })).json()
  assert.equal(created.name, 'tienda-escolar')
  assert.equal(created.displayName, 'Tienda Escolar')
  assert.equal(created.year, new Date().getFullYear())

  const custom = (await register({ name: 'biblio', displayName: 'Biblioteca del aula', year: 2025 })).json()
  assert.deepEqual([custom.displayName, custom.year], ['Biblioteca del aula', 2025])
  assert.equal((await register({ name: 'x', year: 1999 })).statusCode, 400)
  assert.equal((await register({ name: 'y', displayName: '' })).statusCode, 400)
  await app.close()
})

test('un nombre repetido sugiere el mismo con el año, y otro número si ese también existe', async () => {
  const { app, register } = await setup()
  await register({ name: 'tienda', year: 2025 })
  const repeated = await register({ name: 'Tienda', year: 2026 })
  assert.equal(repeated.statusCode, 409)
  assert.equal(repeated.json().suggestion, 'tienda-2026')
  assert.match(repeated.json().message, /por ejemplo “tienda-2026”/)

  assert.equal((await register({ name: 'tienda-2026', year: 2026 })).statusCode, 201)
  assert.equal((await register({ name: 'tienda', year: 2026 })).json().suggestion, 'tienda-2026-2')
  assert.equal((await register({ name: 'tienda-2026', year: 2026 })).json().suggestion, 'tienda-2026-2')
  await app.close()
})

test('la ficha se edita con todos sus campos y valida cada uno', async () => {
  const { app, register, patch } = await setup()
  await register({ name: 'tienda' })
  const contacts = [
    { name: 'Ana Pérez', email: 'ana@escuela.edu', phone: '+503 7000 0000' },
    { name: 'Luis', email: '  ', phone: '' },
  ]
  const edited = await patch(1, { displayName: 'Tienda escolar', year: 2026, description: 'Vende útiles.', instructions: 'Usuario: admin / admin', contacts })
  assert.equal(edited.statusCode, 200)
  const body = edited.json()
  assert.deepEqual(
    [body.displayName, body.year, body.description, body.instructions],
    ['Tienda escolar', 2026, 'Vende útiles.', 'Usuario: admin / admin'],
  )
  // Los campos vacíos de un contacto no se guardan.
  assert.deepEqual(body.contacts, [contacts[0], { name: 'Luis' }])
  // Lo que no llega queda como estaba.
  assert.equal((await patch(1, { notes: 'Revisado' })).json().description, 'Vende útiles.')

  const invalid: unknown[] = [
    { displayName: '' },
    { displayName: 'x'.repeat(81) },
    { year: 1999 },
    { year: 2026.5 },
    { description: 'x'.repeat(2001) },
    { instructions: 'x'.repeat(4001) },
    { contacts: [{ name: '' }] },
    { contacts: [{ name: 'Ana', email: 'no es correo' }] },
    { contacts: [{ name: 'Ana', phone: '1'.repeat(31) }] },
    { contacts: [{ name: 'Ana', edad: 15 }] },
    { contacts: Array.from({ length: 9 }, (_, i) => ({ name: `E${i}` })) },
    { desconocido: 1 },
    {},
  ]
  for (const payload of invalid) {
    const response = await patch(1, payload)
    assert.equal(response.statusCode, 400, JSON.stringify(payload))
    assert.match(response.json().message, /Revisa los datos de la ficha/)
  }
  await app.close()
})

test('la búsqueda mira el nombre para mostrar y la descripción; las carpetas filtran por año', async () => {
  const { app, register, patch } = await setup()
  await register({ name: 'a1', displayName: 'Huerto escolar', year: 2025 })
  await register({ name: 'b2', year: 2026 })
  await register({ name: 'c3', year: 2026 })
  await patch(2, { description: 'Control de préstamos de la biblioteca' })

  const names = async (url: string) => (await app.inject({ method: 'GET', url })).json().map((p: { name: string }) => p.name)
  assert.deepEqual(await names('/api/projects?q=huerto'), ['a1'])
  assert.deepEqual(await names('/api/projects?q=PRESTAMOS'), ['b2'])
  assert.deepEqual(await names('/api/projects?year=2026'), ['c3', 'b2'])
  assert.deepEqual(await names('/api/projects?year=2025&q=biblioteca'), [])
  assert.deepEqual(await names('/api/projects?year=todos'), ['c3', 'b2', 'a1'])
  assert.equal((await app.inject({ method: 'GET', url: '/api/projects?year=2026a' })).statusCode, 400)
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/projects/years' })).json(), [
    { year: 2026, count: 2 },
    { year: 2025, count: 1 },
  ])
  await app.close()
})

test('reconoce PNG, JPEG y WebP por sus bytes, y rechaza SVG y lo demás', () => {
  assert.equal(imageTypeOf(PNG), 'png')
  assert.equal(imageTypeOf(JPEG), 'jpg')
  assert.equal(imageTypeOf(WEBP), 'webp')
  assert.equal(imageTypeOf(SVG), null)
  assert.equal(imageTypeOf(Buffer.from('GIF89a')), null)
  assert.equal(imageTypeOf(Buffer.alloc(0)), null)
})

test('la imagen se sube, se sirve con su tipo y sin adivinar, se cambia y se borra', async () => {
  const { app, dataDir, register } = await setup()
  await register({ name: 'tienda' })
  const uploaded = await app.inject({ method: 'PUT', url: '/api/projects/1/image', ...imageUpload(PNG) })
  assert.equal(uploaded.statusCode, 200)
  const firstUrl = uploaded.json().imageUrl
  assert.match(firstUrl, /^\/api\/projects\/1\/image\?v=\d+$/)
  assert.deepEqual(await readdir(join(dataDir, 'imagenes')), ['1.png'])

  const served = await app.inject({ method: 'GET', url: firstUrl })
  assert.equal(served.statusCode, 200)
  assert.equal(served.headers['content-type'], 'image/png')
  assert.equal(served.headers['x-content-type-options'], 'nosniff')
  assert.equal(served.headers['cache-control'], 'no-cache')
  assert.deepEqual(served.rawPayload, PNG)

  // Otra imagen, aunque el archivo diga .png, se guarda por lo que es, y la dirección cambia.
  const replaced = (await app.inject({ method: 'PUT', url: '/api/projects/1/image', ...imageUpload(JPEG, 'otra.png') })).json()
  assert.notEqual(replaced.imageUrl, firstUrl)
  assert.deepEqual(await readdir(join(dataDir, 'imagenes')), ['1.jpg'])
  assert.equal((await app.inject({ method: 'GET', url: replaced.imageUrl })).headers['content-type'], 'image/jpeg')

  const removed = await app.inject({ method: 'DELETE', url: '/api/projects/1/image' })
  assert.equal(removed.json().imageUrl, null)
  assert.deepEqual(await readdir(join(dataDir, 'imagenes')), [])
  assert.equal((await app.inject({ method: 'GET', url: '/api/projects/1/image' })).statusCode, 404)
  await app.close()
  await rm(dataDir, { recursive: true, force: true })
})

test('la imagen rechaza SVG, archivos grandes y peticiones sin archivo', async () => {
  const { app, dataDir, register } = await setup()
  await register({ name: 'tienda' })
  const svg = await app.inject({ method: 'PUT', url: '/api/projects/1/image', ...imageUpload(SVG, 'logo.svg') })
  assert.equal(svg.statusCode, 400)
  assert.match(svg.json().message, /PNG, JPEG o WebP/)

  const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)])
  const tooBig = await app.inject({ method: 'PUT', url: '/api/projects/1/image', ...imageUpload(big) })
  assert.equal(tooBig.statusCode, 400)
  assert.match(tooBig.json().message, /2 MB/)

  assert.equal((await app.inject({ method: 'PUT', url: '/api/projects/1/image', payload: {} })).statusCode, 400)
  assert.equal((await app.inject({ method: 'PUT', url: '/api/projects/9/image', ...imageUpload(PNG) })).statusCode, 404)
  await assert.rejects(access(join(dataDir, 'imagenes', '1.png')))
  await app.close()
})

test('eliminar el proyecto borra su imagen', async () => {
  const { app, dataDir, register } = await setup()
  await register({ name: 'tienda' })
  await app.inject({ method: 'PUT', url: '/api/projects/1/image', ...imageUpload(WEBP) })
  await access(join(dataDir, 'imagenes', '1.webp'))
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/projects/1' })).statusCode, 204)
  await assert.rejects(access(join(dataDir, 'imagenes', '1.webp')))
  await app.close()
})

test('una base anterior a la ficha recibe sus columnas: nombre para mostrar y año de registro', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dockyard-db-'))
  const path = join(dir, 'app.db')
  const old = new DatabaseSync(path)
  old.exec(`CREATE TABLE projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, team TEXT NOT NULL,
    source_type TEXT NOT NULL, source TEXT NOT NULL, dir TEXT NOT NULL, created_at TEXT NOT NULL,
    warnings TEXT NOT NULL DEFAULT '[]', needs_build INTEGER NOT NULL DEFAULT 0,
    keep_running INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT ''
  ) STRICT`)
  old.exec(`INSERT INTO projects (name, team, source_type, source, dir, created_at)
    VALUES ('viejo', 'E', 'git', 'https://github.com/e/p', '/p', '2025-08-14T10:00:00.000Z')`)
  old.close()

  const repository = createProjectRepository(path)
  const row = repository.list()[0]!
  assert.deepEqual(
    [row.display_name, row.year, row.description, row.instructions, row.contacts, row.image],
    ['viejo', 2025, '', '', '[]', null],
  )
  assert.deepEqual(repository.years(), [{ year: 2025, count: 1 }])
  repository.close()
  // Abrirla otra vez no repite la migración.
  createProjectRepository(path).close()
  await rm(dir, { recursive: true, force: true })
})
