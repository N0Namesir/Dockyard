import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import test from 'node:test'
import { buildApp } from '../src/app.ts'
import type { ProjectSource, ProjectStatus } from '../src/core.ts'
import { createProjectRepository } from '../src/db/projects.ts'
import type { CoreAdapter } from '../src/types.ts'

function normalize(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'proyecto'
}

function fakeCore() {
  const statuses = new Map<string, ProjectStatus>()
  let receivedSource: ProjectSource | undefined

  const core: CoreAdapter = {
    normalizeProjectName: normalize,
    async prepareProject(source, name) {
      receivedSource = source
      if (source.type === 'zip') await access(source.filePath)
      const normalized = normalize(name)
      statuses.set(normalized, { state: 'stopped', ports: [] })
      return { dir: `/projects/${normalized}`, name: normalized }
    },
    async startProject(_dir, name) {
      const status: ProjectStatus = { state: 'running', ports: [8080] }
      statuses.set(name, status)
      return status
    },
    async stopProject(_dir, name) {
      const status: ProjectStatus = { state: 'stopped', ports: [] }
      statuses.set(name, status)
      return status
    },
    async getProjectStatus(name) {
      return statuses.get(name) ?? { state: 'stopped', ports: [] }
    },
  }

  return { core, getReceivedSource: () => receivedSource }
}

async function testApp(core = fakeCore().core) {
  const repository = createProjectRepository(':memory:')
  return buildApp({ repository, core })
}

test('la lista empieza vacía', async () => {
  const app = await testApp()
  const response = await app.inject({ method: 'GET', url: '/api/projects' })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), [])
  await app.close()
})

test('registra por GitHub, consulta, busca, enciende y apaga', async () => {
  const app = await testApp()
  const created = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: { 'content-type': 'application/json' },
    payload: {
      team: 'Equipo Ámbar',
      name: 'Tienda Escolar',
      repoUrl: 'https://github.com/equipo/tienda',
    },
  })

  assert.equal(created.statusCode, 201)
  assert.deepEqual(created.json(), {
    id: 1,
    name: 'tienda-escolar',
    team: 'Equipo Ámbar',
    state: 'stopped',
    ports: [],
    url: null,
  })

  const found = await app.inject({
    method: 'GET',
    url: '/api/projects?q=%C3%81mbar',
  })
  assert.equal(found.statusCode, 200)
  assert.equal(found.json().length, 1)

  const started = await app.inject({
    method: 'POST',
    url: '/api/projects/1/start',
  })
  assert.equal(started.statusCode, 200)
  assert.equal(started.json().state, 'running')
  assert.deepEqual(started.json().ports, [8080])
  assert.equal(started.json().url, 'http://localhost:8080')

  const detail = await app.inject({ method: 'GET', url: '/api/projects/1' })
  assert.equal(detail.json().state, 'running')

  const stopped = await app.inject({
    method: 'POST',
    url: '/api/projects/1/stop',
  })
  assert.equal(stopped.statusCode, 200)
  assert.equal(stopped.json().state, 'stopped')
  assert.equal(stopped.json().url, null)
  await app.close()
})

test('rechaza datos incompletos, URL ajena a GitHub y nombres repetidos', async () => {
  const app = await testApp()

  const incomplete = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: { 'content-type': 'application/json' },
    payload: { team: 'Equipo 1' },
  })
  assert.equal(incomplete.statusCode, 400)

  const invalidUrl = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: { 'content-type': 'application/json' },
    payload: {
      team: 'Equipo 1',
      name: 'Proyecto',
      repoUrl: 'https://gitlab.com/equipo/proyecto',
    },
  })
  assert.equal(invalidUrl.statusCode, 400)

  const payload = {
    team: 'Equipo 1',
    name: 'Proyecto Único',
    repoUrl: 'https://github.com/equipo/proyecto',
  }
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/projects', payload })).statusCode,
    201,
  )
  const duplicate = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { ...payload, name: 'PROYECTO UNICO' },
  })
  assert.equal(duplicate.statusCode, 409)
  assert.match(duplicate.json().message, /Ya existe/)
  await app.close()
})

test('registra un ZIP por multipart y borra el archivo temporal', async () => {
  const fake = fakeCore()
  const app = await testApp(fake.core)
  const boundary = 'dockyard-test-boundary'
  const body = Buffer.from(
    [
      `--${boundary}\r\nContent-Disposition: form-data; name="team"\r\n\r\nEquipo ZIP\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\nProyecto ZIP\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="entrega.zip"\r\nContent-Type: application/zip\r\n\r\ncontenido\r\n`,
      `--${boundary}--\r\n`,
    ].join(''),
  )

  const response = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: body,
  })

  assert.equal(response.statusCode, 201)
  const source = fake.getReceivedSource()
  assert.equal(source?.type, 'zip')
  if (!source || source.type !== 'zip') assert.fail('No se recibió la fuente ZIP')
  await assert.rejects(access(source.filePath))
  await app.close()
})

test('devuelve 404 y conserva el mensaje de una falla del núcleo', async () => {
  const fake = fakeCore()
  const app = await testApp({
    ...fake.core,
    async startProject() {
      throw new Error('El puerto 8080 ya está en uso. Apaga el otro proyecto.')
    },
  })

  const missing = await app.inject({
    method: 'POST',
    url: '/api/projects/99/start',
  })
  assert.equal(missing.statusCode, 404)

  await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: {
      team: 'Equipo 1',
      name: 'Proyecto',
      repoUrl: 'https://github.com/equipo/proyecto',
    },
  })
  const failed = await app.inject({
    method: 'POST',
    url: '/api/projects/1/start',
  })
  assert.equal(failed.statusCode, 500)
  assert.equal(
    failed.json().message,
    'El puerto 8080 ya está en uso. Apaga el otro proyecto.',
  )
  await app.close()
})

test('todos los errores responden solo con message', async () => {
  const app = await testApp()
  const cases: [Parameters<typeof app.inject>[0], number][] = [
    [{ method: 'GET', url: '/api/projects/999' }, 404],
    [{ method: 'GET', url: '/api/projects/abc' }, 400],
    [{ method: 'GET', url: '/api/no-existe' }, 404],
    [{
      method: 'POST',
      url: '/api/projects',
      headers: { 'content-type': 'application/json' },
      payload: '{mal',
    }, 400],
    [{
      method: 'POST',
      url: '/api/projects',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'team=x',
    }, 415],
  ]
  for (const [request, statusCode] of cases) {
    const response = await app.inject(request)
    assert.equal(response.statusCode, statusCode)
    assert.deepEqual(Object.keys(response.json()), ['message'])
    assert.doesNotMatch(response.json().message, /must match|not valid|Unsupported|not found/)
  }
  await app.close()
})

test('una falla del núcleo responde 500 solo con su mensaje', async () => {
  const fake = fakeCore()
  const app = await testApp({
    ...fake.core,
    async prepareProject() {
      throw new Error('No se pudo clonar el repositorio.')
    },
  })
  const response = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { team: 'E', name: 'P', repoUrl: 'https://github.com/e/p' },
  })
  assert.equal(response.statusCode, 500)
  assert.deepEqual(response.json(), { message: 'No se pudo clonar el repositorio.' })
  await app.close()
})

test('la búsqueda ignora tildes y mayúsculas y trata los comodines como texto', async () => {
  const app = await testApp()
  const register = (team: string, name: string) =>
    app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { team, name, repoUrl: 'https://github.com/e/p' },
    })
  await register('Equipo Ámbar', 'Tienda Ñandú')
  await register('Equipo 100%', 'otro_proyecto')
  await register('Equipo 3', 'otroxproyecto')

  const search = async (q: string) => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/projects?q=${encodeURIComponent(q)}`,
    })
    return response.json().map((project: { name: string }) => project.name).sort()
  }

  assert.deepEqual(await search('ámbar'), ['tienda-nandu'])
  assert.deepEqual(await search('AMBAR'), ['tienda-nandu'])
  assert.deepEqual(await search('Tienda Ñandú'), ['tienda-nandu'])
  assert.deepEqual(await search('%'), ['otro_proyecto'])
  assert.deepEqual(await search('otro_p'), ['otro_proyecto'])
  await app.close()
})
