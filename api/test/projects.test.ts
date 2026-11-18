import assert from 'node:assert/strict'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import type { InjectOptions } from 'fastify'
import { buildApp, isAllowedRequest } from '../src/app.ts'
import type { ProjectSource, ProjectStatus } from '../src/core.ts'
import { createProjectRepository } from '../src/db/projects.ts'
import { createProjectService } from '../src/services/projects.ts'
import { createVersionChecker } from '../src/services/version.ts'
import { createWebChecker, type CheckWeb } from '../src/services/web-check.ts'
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
    async reviewProject() {
      return []
    },
    async updateProject() {
      return { dir: '/projects/nuevo', changed: true, commit: 'abc1234', summary: 'Arregla el inicio' }
    },
    async replaceProjectZip(name, filePath) {
      await access(filePath)
      return { dir: `/projects/${name}/nueva`, leftover: null }
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
    async getProjectStatuses() {
      return Object.fromEntries(statuses)
    },
    async getProjectLogs(name) {
      return `registro de ${name}`
    },
    async getResources() {
      return { memoryLimit: 0, projects: {} }
    },
    async removeProject(name) {
      statuses.delete(name)
    },
    async renameProject(name, newName) {
      const status = statuses.get(name)
      statuses.delete(name)
      if (status) statuses.set(newName, status)
      return { dir: `/projects/${newName}`, name: newName }
    },
    async getSelfUpdateStatus() {
      return { supported: false, running: false }
    },
    async startSelfUpdate() {
      throw new Error('No se actualiza en las pruebas.')
    },
  }

  return { core, getReceivedSource: () => receivedSource }
}

async function testApp(core = fakeCore().core, checkWeb: CheckWeb = async () => ({ state: 'ok', httpStatus: 200 })) {
  const repository = createProjectRepository(':memory:')
  return buildApp({ repository, core, checkWeb })
}

test('la lista consulta el estado de todos con una sola llamada a Docker', async () => {
  const { core } = fakeCore()
  let all = 0
  let single = 0
  const app = await testApp({
    ...core,
    async getProjectStatus(name) {
      single++
      return core.getProjectStatus(name)
    },
    async getProjectStatuses() {
      all++
      return { b: { state: 'running', ports: [8101] }, 'otro-de-la-pc': { state: 'running', ports: [9000] } }
    },
  })
  for (const name of ['A', 'B', 'C']) {
    await app.inject({ method: 'POST', url: '/api/projects', payload: { team: 'E', name, repoUrl: `https://github.com/e/${name}` } })
  }
  single = 0
  const list = (await app.inject({ method: 'GET', url: '/api/projects' })).json()
  assert.equal(all, 1)
  assert.equal(single, 0)
  assert.deepEqual(
    list.map((p: { name: string; state: string; ports: number[] }) => [p.name, p.state, p.ports]),
    [['c', 'stopped', []], ['b', 'running', [8101]], ['a', 'stopped', []]],
  )

  // Sin proyectos registrados no hace falta preguntar a Docker.
  await app.inject({ method: 'GET', url: '/api/projects?q=nada' })
  assert.equal(all, 1)
  await app.close()
})

test('el avance se ve mientras enciende y desaparece al terminar', async () => {
  let finish = () => {}
  const { core } = fakeCore()
  const app = await testApp({
    ...core,
    async startProject(_dir, _name, options) {
      options?.onProgress?.({ stage: 'Construyendo imágenes', lines: ['#1 DONE'] })
      await new Promise<void>((resolve) => { finish = resolve })
      return { state: 'running', ports: [] }
    },
  })
  await app.inject({ method: 'POST', url: '/api/projects', payload: { team: 'E', name: 'A', repoUrl: 'https://github.com/e/a' } })
  const idle = await app.inject({ method: 'GET', url: '/api/projects/1/progress' })
  assert.deepEqual(idle.json(), { progress: null })

  const started = app.inject({ method: 'POST', url: '/api/projects/1/start' })
  while ((await app.inject({ method: 'GET', url: '/api/projects/1/progress' })).json().progress?.lines.length !== 1) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  const { progress } = (await app.inject({ method: 'GET', url: '/api/projects/1/progress' })).json()
  assert.equal(progress.stage, 'Construyendo imágenes')
  assert.deepEqual(progress.lines, ['#1 DONE'])
  assert.equal(typeof progress.elapsedSeconds, 'number')
  assert.equal((await app.inject({ method: 'GET', url: '/api/projects' })).json()[0].progress.stage, 'Construyendo imágenes')

  finish()
  assert.equal((await started).json().progress, null)
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/projects/1/progress' })).json(), { progress: null })
})

test('un encendido que falla no deja avance, y pedirlo de otro proyecto da 404', async () => {
  const { core } = fakeCore()
  const app = await testApp({
    ...core,
    async startProject() {
      throw new Error('falló')
    },
  })
  await app.inject({ method: 'POST', url: '/api/projects', payload: { team: 'E', name: 'A', repoUrl: 'https://github.com/e/a' } })
  assert.equal((await app.inject({ method: 'POST', url: '/api/projects/1/start' })).statusCode, 500)
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/projects/1/progress' })).json(), { progress: null })
  assert.equal((await app.inject({ method: 'GET', url: '/api/projects/99/progress' })).statusCode, 404)
})

const REPO = { team: 'E', name: 'A', repoUrl: 'https://github.com/e/a' }

test('actualizar guarda la revisión nueva y el siguiente encendido reconstruye una vez', async () => {
  const { core } = fakeCore()
  const builds: (boolean | undefined)[] = []
  const app = await testApp({
    ...core,
    async reviewProject() {
      return ['Servicio web: usa privileged.']
    },
    async startProject(dir, name, options) {
      builds.push(options?.build)
      assert.equal(dir, '/projects/nuevo')
      return core.startProject(dir, name, options)
    },
  })
  await app.inject({ method: 'POST', url: '/api/projects', payload: REPO })
  const updated = (await app.inject({ method: 'POST', url: '/api/projects/1/update' })).json()
  assert.equal(updated.changed, true)
  assert.equal(updated.commit, 'abc1234')
  assert.equal(updated.summary, 'Arregla el inicio')
  assert.equal(updated.project.pendingBuild, true)
  assert.deepEqual(updated.project.warnings, ['Servicio web: usa privileged.'])

  const started = (await app.inject({ method: 'POST', url: '/api/projects/1/start' })).json()
  assert.equal(started.pendingBuild, false)
  await app.inject({ method: 'POST', url: '/api/projects/1/stop' })
  await app.inject({ method: 'POST', url: '/api/projects/1/start' })
  assert.deepEqual(builds, [true, false])
})

test('si el encendido falla tras actualizar, el siguiente intento también reconstruye', async () => {
  const { core } = fakeCore()
  const builds: (boolean | undefined)[] = []
  const app = await testApp({
    ...core,
    async startProject(_dir, _name, options) {
      builds.push(options?.build)
      throw new Error('falló')
    },
  })
  await app.inject({ method: 'POST', url: '/api/projects', payload: REPO })
  await app.inject({ method: 'POST', url: '/api/projects/1/update' })
  await app.inject({ method: 'POST', url: '/api/projects/1/start' })
  await app.inject({ method: 'POST', url: '/api/projects/1/start' })
  assert.deepEqual(builds, [true, true])
})

test('sin cambios no toca la revisión ni pide reconstruir', async () => {
  const { core } = fakeCore()
  let reviews = 0
  const app = await testApp({
    ...core,
    async reviewProject() {
      reviews++
      return []
    },
    async updateProject() {
      return { dir: '/x', changed: false, commit: 'abc1234', summary: 'Igual' }
    },
  })
  await app.inject({ method: 'POST', url: '/api/projects', payload: REPO })
  const updated = (await app.inject({ method: 'POST', url: '/api/projects/1/update' })).json()
  assert.equal(updated.changed, false)
  assert.equal(updated.project.pendingBuild, false)
  assert.equal(reviews, 1)
})

test('no se actualiza un proyecto encendido, ni uno de ZIP, ni uno que no existe', async () => {
  const { core } = fakeCore()
  let updates = 0
  const app = await testApp({
    ...core,
    async updateProject(name) {
      updates++
      return core.updateProject(name)
    },
  })
  await app.inject({ method: 'POST', url: '/api/projects', payload: REPO })
  await app.inject({ method: 'POST', url: '/api/projects/1/start' })
  const running = await app.inject({ method: 'POST', url: '/api/projects/1/update' })
  assert.equal(running.statusCode, 409)
  assert.match(running.json().message, /Apaga el proyecto/)
  assert.equal((await app.inject({ method: 'POST', url: '/api/projects/99/update' })).statusCode, 404)
  assert.equal(updates, 0)

  const repository = createProjectRepository(':memory:')
  repository.insert({ name: 'z', team: 'E', sourceType: 'zip', source: 'z.zip', dir: '/z', warnings: [] })
  const zipApp = await buildApp({ repository, core, checkWeb: async () => ({ state: 'ok', httpStatus: 200 }) })
  const zip = await zipApp.inject({ method: 'POST', url: '/api/projects/1/update' })
  assert.equal(zip.statusCode, 409)
  assert.match(zip.json().message, /GitHub/)
})

test('el consumo solo incluye proyectos registrados, suma el total y comparte la muestra', async () => {
  const { core } = fakeCore()
  let samples = 0
  const web = { service: 'web', cpuPercent: 2, memoryBytes: 100 }
  const app = await testApp({
    ...core,
    async getResources() {
      samples++
      return {
        memoryLimit: 1000,
        projects: {
          a: { cpuPercent: 2, memoryBytes: 100, services: [web] },
          b: { cpuPercent: 3, memoryBytes: 200, services: [] },
          ajeno: { cpuPercent: 50, memoryBytes: 900, services: [] },
        },
      }
    },
  })
  await app.inject({ method: 'POST', url: '/api/projects', payload: REPO })
  await app.inject({ method: 'POST', url: '/api/projects', payload: { ...REPO, name: 'B' } })
  const response = await app.inject({ method: 'GET', url: '/api/projects/resources' })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), {
    memoryLimit: 1000,
    total: { cpuPercent: 5, memoryBytes: 300 },
    projects: {
      1: { cpuPercent: 2, memoryBytes: 100, services: [web] },
      2: { cpuPercent: 3, memoryBytes: 200, services: [] },
    },
  })
  await app.inject({ method: 'GET', url: '/api/projects/resources' })
  assert.equal(samples, 1)
})

test('una falla al leer el consumo se informa y no queda guardada', async () => {
  const { core } = fakeCore()
  let samples = 0
  const app = await testApp({
    ...core,
    async getResources() {
      if (++samples === 1) throw new Error('Docker no responde.')
      return { memoryLimit: 1000, projects: {} }
    },
  })
  const failed = await app.inject({ method: 'GET', url: '/api/projects/resources' })
  assert.equal(failed.statusCode, 500)
  assert.equal(failed.json().message, 'Docker no responde.')
  assert.equal((await app.inject({ method: 'GET', url: '/api/projects/resources' })).statusCode, 200)
})

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
    urls: [],
    failedServices: [],
    web: null,
    warnings: [],
    progress: null,
    pendingBuild: false,
    sourceType: 'git',
    notes: '',
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

/** Cuerpo multipart con un archivo en el campo "file", como lo manda el navegador. */
function zipUpload(filename: string, fields: Record<string, string> = {}) {
  const boundary = 'dockyard-test-boundary'
  const payload = Buffer.from([
    ...Object.entries(fields).map(([key, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`),
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/zip\r\n\r\ncontenido\r\n`,
    `--${boundary}--\r\n`,
  ].join(''))
  return { headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload }
}

test('reemplazar el ZIP repite la revisión, marca reconstruir y borra el archivo temporal', async () => {
  const fake = fakeCore()
  let received = ''
  let reviews = 0
  let started: { dir: string; build?: boolean } | undefined
  const app = await testApp({
    ...fake.core,
    async startProject(dir, name, options) {
      started = { dir, build: options?.build }
      return fake.core.startProject(dir, name)
    },
    async replaceProjectZip(name, filePath) {
      received = filePath
      return fake.core.replaceProjectZip(name, filePath)
    },
    async reviewProject(dir) {
      reviews++
      return dir.endsWith('/nueva') ? ['El compose nuevo publica la base de datos.'] : []
    },
  })
  const created = await app.inject({ method: 'POST', url: '/api/projects', ...zipUpload('entrega.zip', { team: 'E', name: 'Tienda' }) })
  assert.equal(created.statusCode, 201)

  const response = await app.inject({ method: 'POST', url: '/api/projects/1/replace', ...zipUpload('entrega-corregida.zip') })
  assert.equal(response.statusCode, 200)
  const { project, leftover } = response.json()
  assert.equal(leftover, null)
  assert.equal(project.name, 'tienda')
  assert.equal(project.team, 'E')
  assert.equal(project.pendingBuild, true)
  assert.deepEqual(project.warnings, ['El compose nuevo publica la base de datos.'])
  assert.equal(reviews, 2)
  await assert.rejects(access(received))

  // El siguiente encendido usa la carpeta nueva y reconstruye.
  await app.inject({ method: 'POST', url: '/api/projects/1/start' })
  assert.deepEqual(started, { dir: '/projects/tienda/nueva', build: true })
  await app.close()
})

test('reemplazar el ZIP: rechaza GitHub, proyectos encendidos y peticiones sin archivo', async () => {
  const fake = fakeCore()
  let calls = 0
  const app = await testApp({
    ...fake.core,
    async replaceProjectZip(name, filePath) {
      calls++
      return fake.core.replaceProjectZip(name, filePath)
    },
  })
  await app.inject({ method: 'POST', url: '/api/projects', payload: { team: 'E', name: 'Git', repoUrl: 'https://github.com/e/git' } })
  await app.inject({ method: 'POST', url: '/api/projects', ...zipUpload('a.zip', { team: 'E', name: 'Zip' }) })

  const git = await app.inject({ method: 'POST', url: '/api/projects/1/replace', ...zipUpload('b.zip') })
  assert.equal(git.statusCode, 409)
  assert.match(git.json().message, /Para uno de GitHub, usa Actualizar/)

  const missing = await app.inject({ method: 'POST', url: '/api/projects/99/replace', ...zipUpload('b.zip') })
  assert.equal(missing.statusCode, 404)

  const noFile = await app.inject({ method: 'POST', url: '/api/projects/2/replace', payload: {} })
  assert.equal(noFile.statusCode, 400)
  const wrongType = await app.inject({ method: 'POST', url: '/api/projects/2/replace', ...zipUpload('b.rar') })
  assert.equal(wrongType.statusCode, 400)
  assert.match(wrongType.json().message, /\.zip/)

  await app.inject({ method: 'POST', url: '/api/projects/2/start' })
  const running = await app.inject({ method: 'POST', url: '/api/projects/2/replace', ...zipUpload('b.zip') })
  assert.equal(running.statusCode, 409)
  assert.match(running.json().message, /Apaga el proyecto/)
  assert.equal(calls, 0)
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

function portConflict(port: number, project: string | null): Error {
  return Object.assign(new Error(`El puerto ${port} ya está en uso por el contenedor ${project ?? 'suelto'}-web-1. Apaga ese proyecto o cambia el puerto en el compose.`), {
    name: 'PortConflictError',
    port,
    container: `${project ?? 'suelto'}-web-1`,
    project,
  })
}

test('un choque de puertos con otro proyecto registrado responde 409 con ese proyecto', async () => {
  const fake = fakeCore()
  const app = await testApp({
    ...fake.core,
    async startProject(_dir, name) {
      if (name === 'nuevo') throw portConflict(8081, 'viejo')
      return { state: 'running', ports: [8081] }
    },
  })
  for (const name of ['Viejo', 'Nuevo']) {
    await app.inject({ method: 'POST', url: '/api/projects', payload: { team: 'E', name, repoUrl: `https://github.com/e/${name}` } })
  }

  const failed = await app.inject({ method: 'POST', url: '/api/projects/2/start' })
  assert.equal(failed.statusCode, 409)
  assert.deepEqual(failed.json(), {
    message: 'El puerto 8081 ya lo usa el proyecto viejo, que está encendido. Apágalo o pide al equipo que cambie el puerto en el compose.',
    conflict: { id: 1, name: 'viejo', port: 8081 },
  })
  await app.close()
})

test('un choque con algo que Dockyard no registró conserva el mensaje del núcleo', async () => {
  const fake = fakeCore()
  for (const project of [null, 'ajeno']) {
    const app = await testApp({
      ...fake.core,
      async startProject() {
        throw portConflict(8081, project)
      },
    })
    await app.inject({ method: 'POST', url: '/api/projects', payload: { team: 'E', name: 'Nuevo', repoUrl: 'https://github.com/e/nuevo' } })
    const failed = await app.inject({ method: 'POST', url: '/api/projects/1/start' })
    assert.equal(failed.statusCode, 500)
    assert.deepEqual(Object.keys(failed.json()), ['message'])
    assert.match(failed.json().message, /^El puerto 8081 ya está en uso por el contenedor/)
    await app.close()
  }
})

async function registerNamed(app: Awaited<ReturnType<typeof testApp>>, ...names: string[]) {
  for (const name of names) {
    await app.inject({ method: 'POST', url: '/api/projects', payload: { team: 'E', name, repoUrl: `https://github.com/e/${name}` } })
  }
}

test('apagar todos apaga solo los registrados encendidos e informa las fallas', async () => {
  const fake = fakeCore()
  const stopped: string[] = []
  const app = await testApp({
    ...fake.core,
    async getProjectStatuses() {
      // "ajeno" corre en la PC pero no está registrado: no se toca.
      return { ...(await fake.core.getProjectStatuses()), ajeno: { state: 'running', ports: [9000] } }
    },
    async stopProject(dir, name) {
      if (name === 'roto') throw new Error('Docker no responde.')
      stopped.push(name)
      return fake.core.stopProject(dir, name)
    },
  })
  await registerNamed(app, 'Uno', 'Dos', 'Roto', 'Apagado')
  for (const id of [1, 2, 3]) await app.inject({ method: 'POST', url: `/api/projects/${id}/start` })

  const response = await app.inject({ method: 'POST', url: '/api/projects/stop-all' })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), {
    stopped: ['dos', 'uno'],
    skipped: [],
    failed: [{ name: 'roto', message: 'Docker no responde.' }],
  })
  assert.deepEqual(stopped.sort(), ['dos', 'uno'])
  const list = (await app.inject({ method: 'GET', url: '/api/projects' })).json()
  assert.deepEqual(list.map((p: { name: string; state: string }) => `${p.name}:${p.state}`).sort(),
    ['apagado:stopped', 'dos:stopped', 'roto:running', 'uno:stopped'])
  await app.close()
})

test('apagar todos sin nada encendido no falla y repetirlo se une a la tanda en curso', async () => {
  const fake = fakeCore()
  let calls = 0
  let finish: () => void = () => {}
  const gate = new Promise<void>((done) => { finish = done })
  const app = await testApp({
    ...fake.core,
    async stopProject(dir, name) {
      calls++
      await gate
      return fake.core.stopProject(dir, name)
    },
  })
  const empty = await app.inject({ method: 'POST', url: '/api/projects/stop-all' })
  assert.deepEqual(empty.json(), { stopped: [], skipped: [], failed: [] })

  await registerNamed(app, 'Uno')
  await app.inject({ method: 'POST', url: '/api/projects/1/start' })
  const first = app.inject({ method: 'POST', url: '/api/projects/stop-all' })
  const second = app.inject({ method: 'POST', url: '/api/projects/stop-all' })
  await new Promise((done) => setTimeout(done, 50))
  finish()
  const [a, b] = await Promise.all([first, second])
  assert.equal(calls, 1)
  assert.deepEqual(a.json(), { stopped: ['uno'], skipped: [], failed: [] })
  assert.deepEqual(b.json(), a.json())
  await app.close()
})

test('apagar todos salta los proyectos que se están encendiendo', async () => {
  const fake = fakeCore()
  let finish: () => void = () => {}
  const gate = new Promise<void>((done) => { finish = done })
  const app = await testApp({
    ...fake.core,
    async startProject(dir, name) {
      const status = await fake.core.startProject(dir, name)
      if (name === 'lento') await gate
      return status
    },
  })
  await registerNamed(app, 'Uno', 'Lento')
  await app.inject({ method: 'POST', url: '/api/projects/1/start' })
  const starting = app.inject({ method: 'POST', url: '/api/projects/2/start' })
  await new Promise((done) => setTimeout(done, 50))

  const response = await app.inject({ method: 'POST', url: '/api/projects/stop-all' })
  assert.deepEqual(response.json(), { stopped: ['uno'], skipped: ['lento'], failed: [] })
  finish()
  assert.equal((await starting).json().state, 'running')
  await app.close()
})

test('al arrancar vuelve a encender lo que el docente dejó encendido', async () => {
  const { core } = fakeCore()
  const repository = createProjectRepository(':memory:')
  const service = createProjectService(repository, core, async () => ({ state: 'ok', httpStatus: 200 }))
  const ids: Record<string, number> = {}
  for (const name of ['encendido', 'apagado', 'falla', 'ya-corre', 'externo']) {
    const project = await service.register({ team: 'E', name, source: { type: 'git', url: `https://github.com/e/${name}` }, sourceLabel: name })
    ids[name] = project.id
  }
  for (const name of ['encendido', 'falla', 'ya-corre']) await service.start(ids[name]!)
  await service.start(ids.apagado!)
  await service.stop(ids.apagado!)
  const keep = () => Object.fromEntries(repository.list().map((row) => [row.name, row.keep_running]))
  assert.deepEqual(keep(), { externo: 0, 'ya-corre': 1, falla: 1, apagado: 0, encendido: 1 })

  // Se reinicia la PC: todo queda apagado, salvo "ya-corre" y uno encendido fuera de Dockyard.
  const started: string[] = []
  const rebooted: CoreAdapter = {
    ...core,
    async getProjectStatuses() {
      return {
        'ya-corre': { state: 'running', ports: [8080] },
        externo: { state: 'running', ports: [8090] },
      }
    },
    async startProject(dir, name, options) {
      started.push(name)
      if (name === 'falla') throw new Error('El puerto 8080 ya está en uso.')
      return core.startProject(dir, name, options)
    },
  }
  const after = createProjectService(repository, rebooted, async () => ({ state: 'ok', httpStatus: 200 }))
  const result = await after.resume()
  assert.deepEqual(started.sort(), ['encendido', 'falla'])
  assert.deepEqual(result.started, ['encendido'])
  assert.deepEqual(result.failed, [{ name: 'falla', message: 'El puerto 8080 ya está en uso.' }])
  // El que falló sigue marcado; el que ya corría se marca para el próximo reinicio.
  assert.deepEqual(keep(), { externo: 1, 'ya-corre': 1, falla: 1, apagado: 0, encendido: 1 })

  // Apagar todos también desmarca lo que apaga (aquí, los dos que Docker da por encendidos).
  assert.deepEqual((await after.stopAll()).stopped.sort(), ['externo', 'ya-corre'])
  assert.deepEqual(keep(), { externo: 0, 'ya-corre': 0, falla: 1, apagado: 0, encendido: 1 })
  repository.close()
})

test('al escuchar vuelve a encender, y espera a Docker si aún no responde', async () => {
  const { core } = fakeCore()
  const repository = createProjectRepository(':memory:')
  const first = createProjectService(repository, core, async () => ({ state: 'ok', httpStatus: 200 }))
  const project = await first.register({ team: 'E', name: 'tienda', source: { type: 'git', url: 'https://github.com/e/t' }, sourceLabel: 't' })
  await first.start(project.id)

  let calls = 0
  let resolveStarted: (name: string) => void = () => {}
  const started = new Promise<string>((resolve) => { resolveStarted = resolve })
  const app = await buildApp({
    repository,
    resumeProjects: true,
    resumeRetryMs: 1,
    checkWeb: async () => ({ state: 'ok', httpStatus: 200 }),
    core: {
      ...core,
      async getProjectStatuses() {
        if (++calls < 3) throw new Error('Docker no responde.')
        return {}
      },
      async startProject(dir, name, options) {
        resolveStarted(name)
        return core.startProject(dir, name, options)
      },
    },
  })
  await app.listen({ host: '127.0.0.1', port: 0 })
  assert.equal(await started, 'tienda')
  assert.equal(calls, 3)
  await app.close()
})

test('sin la opción, construir la app no enciende nada', async () => {
  const { core } = fakeCore()
  let starts = 0
  const app = await testApp({ ...core, async startProject(dir, name, options) { starts++; return core.startProject(dir, name, options) } })
  await app.listen({ host: '127.0.0.1', port: 0 })
  await app.close()
  assert.equal(starts, 0)
})

test('editar cambia el equipo y el nombre; el siguiente encendido usa el nombre nuevo y reconstruye', async () => {
  const { core } = fakeCore()
  const renames: string[][] = []
  const starts: { dir: string; name: string; build?: boolean }[] = []
  const app = await testApp({
    ...core,
    async renameProject(name, newName) {
      renames.push([name, newName])
      return core.renameProject(name, newName)
    },
    async startProject(dir, name, options) {
      starts.push({ dir, name, build: options?.build })
      return core.startProject(dir, name, options)
    },
  })
  const created = (await app.inject({ method: 'POST', url: '/api/projects', payload: { team: 'E', name: 'Tienda Mal', repoUrl: 'https://github.com/e/t' } })).json()

  // Solo el equipo: no toca Docker.
  let response = await app.inject({ method: 'PATCH', url: `/api/projects/${created.id}`, payload: { team: '  Equipo 9 ' } })
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().team, 'Equipo 9')
  assert.equal(response.json().pendingBuild, false)
  assert.deepEqual(renames, [])

  // El mismo nombre, escrito distinto, tampoco.
  await app.inject({ method: 'PATCH', url: `/api/projects/${created.id}`, payload: { name: 'TIENDA mal' } })
  assert.deepEqual(renames, [])

  response = await app.inject({ method: 'PATCH', url: `/api/projects/${created.id}`, payload: { name: 'Tienda Escolar' } })
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().name, 'tienda-escolar')
  assert.equal(response.json().pendingBuild, true)
  assert.deepEqual(renames, [['tienda-mal', 'tienda-escolar']])

  // El nombre anterior queda libre y el nuevo se encuentra.
  assert.equal((await app.inject({ method: 'GET', url: '/api/projects?q=escolar' })).json().length, 1)
  assert.equal((await app.inject({ method: 'POST', url: '/api/projects', payload: { team: 'E', name: 'Tienda Mal', repoUrl: 'https://github.com/e/t' } })).statusCode, 201)

  await app.inject({ method: 'POST', url: `/api/projects/${created.id}/start` })
  assert.deepEqual(starts, [{ dir: '/projects/tienda-escolar', name: 'tienda-escolar', build: true }])
  await app.close()
})

test('editar: rechaza encendidos, nombres repetidos, campos vacíos o desconocidos y proyectos que no existen', async () => {
  const app = await testApp()
  const a = (await app.inject({ method: 'POST', url: '/api/projects', payload: { team: 'E', name: 'A', repoUrl: 'https://github.com/e/a' } })).json()
  await app.inject({ method: 'POST', url: '/api/projects', payload: { team: 'E', name: 'B', repoUrl: 'https://github.com/e/b' } })

  let response = await app.inject({ method: 'PATCH', url: `/api/projects/${a.id}`, payload: { name: 'b' } })
  assert.equal(response.statusCode, 409)
  assert.match(response.json().message, /Ya existe un proyecto con el nombre “b”/)

  for (const payload of [{ team: '' }, { name: '   ' }, { team: 'E', dir: '/etc' }, {}]) {
    response = await app.inject({ method: 'PATCH', url: `/api/projects/${a.id}`, payload })
    assert.equal(response.statusCode, 400, JSON.stringify(payload))
  }
  assert.equal((await app.inject({ method: 'PATCH', url: '/api/projects/999', payload: { team: 'X' } })).statusCode, 404)

  await app.inject({ method: 'POST', url: `/api/projects/${a.id}/start` })
  response = await app.inject({ method: 'PATCH', url: `/api/projects/${a.id}`, payload: { name: 'nuevo' } })
  assert.equal(response.statusCode, 409)
  assert.equal(response.json().message, 'Apaga el proyecto antes de cambiarle el nombre.')
  // El equipo sí se cambia encendido.
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/projects/${a.id}`, payload: { team: 'Otro' } })).json().team, 'Otro')
  await app.close()
})

test('las notas se guardan, se borran con texto vacío y tienen un límite', async () => {
  const app = await testApp()
  const created = (await app.inject({ method: 'POST', url: '/api/projects', payload: { team: 'E', name: 'A', repoUrl: 'https://github.com/e/a' } })).json()
  assert.equal(created.notes, '')

  let response = await app.inject({ method: 'PATCH', url: `/api/projects/${created.id}`, payload: { notes: '  Falta el login.\nNota: 8  ' } })
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().notes, 'Falta el login.\nNota: 8')
  assert.equal((await app.inject({ method: 'GET', url: '/api/projects' })).json()[0].notes, 'Falta el login.\nNota: 8')

  assert.equal((await app.inject({ method: 'PATCH', url: `/api/projects/${created.id}`, payload: { notes: 'x'.repeat(2001) } })).statusCode, 400)
  response = await app.inject({ method: 'PATCH', url: `/api/projects/${created.id}`, payload: { notes: '' } })
  assert.equal(response.json().notes, '')
  await app.close()
})

test('mientras registra, figura en /registrations con su etapa y reserva el nombre', async () => {
  const { core } = fakeCore()
  let finish: () => void = () => {}
  const gate = new Promise<void>((resolve) => { finish = resolve })
  const app = await testApp({
    ...core,
    async prepareProject(source, name, options) {
      options?.onProgress?.({ stage: 'Descargando el repositorio', percent: 40 })
      await gate
      return core.prepareProject(source, name, options)
    },
  })
  const payload = { team: 'E', name: 'Grande', repoUrl: 'https://github.com/e/grande' }
  const pending = app.inject({ method: 'POST', url: '/api/projects', payload })
  let list: { key: string; name: string; team: string; sourceType: string; stage: string; percent: number | null; error: string | null }[] = []
  for (let i = 0; i < 50 && list.length === 0; i++) {
    list = (await app.inject({ method: 'GET', url: '/api/registrations' })).json()
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.equal(list.length, 1)
  const { key, ...rest } = list[0]!
  assert.match(key, /^[0-9a-f-]{36}$/)
  assert.deepEqual({ ...rest, elapsedSeconds: 0 }, { name: 'grande', team: 'E', sourceType: 'git', stage: 'Descargando el repositorio', percent: 40, error: null, elapsedSeconds: 0 })

  const repeated = await app.inject({ method: 'POST', url: '/api/projects', payload: { ...payload, name: 'GRANDE' } })
  assert.equal(repeated.statusCode, 409)
  assert.match(repeated.json().message, /Ya se está registrando/)
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/registrations/${key}` })).statusCode, 409)

  finish()
  assert.equal((await pending).statusCode, 201)
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/registrations' })).json(), [])
  await app.close()
})

test('una falla sin nadie esperando queda en la lista hasta descartarla', async () => {
  const { core } = fakeCore()
  let fail = true
  const repository = createProjectRepository(':memory:')
  const service = createProjectService(repository, {
    ...core,
    async prepareProject(source, name, options) {
      if (fail) throw new Error('No se pudo clonar el repositorio.')
      return core.prepareProject(source, name, options)
    },
  }, async () => ({ state: 'ok', httpStatus: 200 }))
  const input = { team: 'E', name: 'tienda', source: { type: 'git' as const, url: 'https://github.com/e/t' }, sourceLabel: 't' }

  // Con la pestaña abierta, el error va en la respuesta y no queda en la lista.
  await assert.rejects(service.register({ ...input, abandoned: () => false }), /No se pudo clonar/)
  assert.deepEqual(service.registrations(), [])

  await assert.rejects(service.register({ ...input, abandoned: () => true }), /No se pudo clonar/)
  const [failed] = service.registrations()
  assert.equal(failed?.error, 'No se pudo clonar el repositorio.')
  assert.equal(failed?.percent, null)

  // Reintentar con el mismo nombre reemplaza la falla.
  fail = false
  await service.register({ ...input, abandoned: () => true })
  assert.deepEqual(service.registrations(), [])

  fail = true
  await assert.rejects(service.register({ ...input, name: 'otra', abandoned: () => true }))
  const key = service.registrations()[0]!.key
  service.dismissRegistration(key)
  assert.deepEqual(service.registrations(), [])
  assert.throws(() => service.dismissRegistration(key), /ya no está en la lista/)
  repository.close()
})

test('descartar un registro valida la clave', async () => {
  const app = await testApp()
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/registrations/no-es-clave' })).statusCode, 400)
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/registrations/00000000-0000-0000-0000-000000000000' })).statusCode, 404)
  await app.close()
})

test('una petición repetida se une a la operación en curso', async () => {
  const fake = fakeCore()
  let calls = 0
  let finish: () => void = () => {}
  const gate = new Promise<void>((done) => { finish = done })
  const app = await testApp({
    ...fake.core,
    async startProject() {
      calls++
      await gate
      throw new Error('Los contenedores se detuvieron enseguida.')
    },
  })
  await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { team: 'E', name: 'P', repoUrl: 'https://github.com/e/p' },
  })

  const first = app.inject({ method: 'POST', url: '/api/projects/1/start' })
  const second = app.inject({ method: 'POST', url: '/api/projects/1/start' })
  await new Promise((done) => setTimeout(done, 50))
  finish()
  const responses = await Promise.all([first, second])

  assert.equal(calls, 1)
  for (const response of responses) {
    assert.equal(response.statusCode, 500)
    assert.deepEqual(response.json(), { message: 'Los contenedores se detuvieron enseguida.' })
  }

  // Terminada la operación, una petición nueva vuelve a ejecutarla.
  await app.inject({ method: 'POST', url: '/api/projects/1/start' })
  assert.equal(calls, 2)
  await app.close()
})

test('rechaza una URL con credenciales sin llamar al núcleo', async () => {
  const fake = fakeCore()
  const app = await testApp(fake.core)
  for (const repoUrl of [
    'https://usuario:token@github.com/equipo/proyecto',
    'https://token@github.com/equipo/proyecto',
  ]) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { team: 'E', name: 'P', repoUrl },
    })
    assert.equal(response.statusCode, 400)
    assert.match(response.json().message, /usuario ni contraseña/)
  }
  assert.equal(fake.getReceivedSource(), undefined)
  await app.close()
})

test('Abrir evita los puertos de bases de datos y urls enlaza todos', async () => {
  const fake = fakeCore()
  const app = await testApp({
    ...fake.core,
    async startProject() {
      return { state: 'running', ports: [3306, 8084] }
    },
  })
  await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { team: 'E', name: 'P', repoUrl: 'https://github.com/e/p' },
  })
  const started = (await app.inject({ method: 'POST', url: '/api/projects/1/start' })).json()
  assert.equal(started.url, 'http://localhost:8084')
  assert.deepEqual(started.urls, ['http://localhost:3306', 'http://localhost:8084'])
  await app.close()
})

test('si solo hay puertos de bases de datos, Abrir usa el primero', async () => {
  const fake = fakeCore()
  const app = await testApp({
    ...fake.core,
    async startProject() {
      return { state: 'running', ports: [5432] }
    },
  })
  await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { team: 'E', name: 'P', repoUrl: 'https://github.com/e/p' },
  })
  const started = (await app.inject({ method: 'POST', url: '/api/projects/1/start' })).json()
  assert.equal(started.url, 'http://localhost:5432')
  await app.close()
})

test('solo acepta peticiones de su propia página en esta PC', () => {
  const allowed: [string, string | undefined][] = [
    ['localhost:4300', undefined],
    ['127.0.0.1:4300', undefined],
    ['[::1]:4300', undefined],
    ['localhost:4300', 'http://localhost:4300'],
    ['127.0.0.1:4300', 'http://127.0.0.1:4300'],
    ['localhost:4321', 'http://localhost:4321'],
  ]
  for (const [host, origin] of allowed) {
    assert.equal(isAllowedRequest(host, origin), true, `${host} ${origin}`)
  }

  const rejected: [string | undefined, string | undefined][] = [
    [undefined, undefined],
    ['sitio-malo.example', undefined],
    ['localhost.sitio-malo.example:4300', undefined],
    ['192.168.1.20:4300', undefined],
    ['localhost:4300', 'https://sitio-malo.example'],
    ['localhost:4300', 'http://localhost:8081'],
    ['localhost:4300', 'http://127.0.0.1:4300'],
    ['localhost:4300', 'null'],
  ]
  for (const [host, origin] of rejected) {
    assert.equal(isAllowedRequest(host, origin), false, `${host} ${origin}`)
  }
})

test('una petición de otra página no llega al núcleo', async () => {
  const fake = fakeCore()
  let starts = 0
  const app = await testApp({
    ...fake.core,
    async startProject() {
      starts++
      return { state: 'running', ports: [] }
    },
  })
  await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { team: 'E', name: 'P', repoUrl: 'https://github.com/e/p' },
  })
  const response = await app.inject({
    method: 'POST',
    url: '/api/projects/1/start',
    headers: { origin: 'https://sitio-malo.example' },
  })
  assert.equal(response.statusCode, 403)
  assert.deepEqual(Object.keys(response.json()), ['message'])
  assert.equal(starts, 0)
  await app.close()
})

const repoProject = { team: 'E', name: 'P', repoUrl: 'https://github.com/e/p' }

test('devuelve los servicios caídos y el registro', async () => {
  const fake = fakeCore()
  const app = await testApp({
    ...fake.core,
    async startProject() {
      return { state: 'running', ports: [], failedServices: ['api'] }
    },
  })
  await app.inject({ method: 'POST', url: '/api/projects', payload: repoProject })
  const started = await app.inject({ method: 'POST', url: '/api/projects/1/start' })
  assert.deepEqual(started.json().failedServices, ['api'])

  const logs = await app.inject({ method: 'GET', url: '/api/projects/1/logs' })
  assert.equal(logs.statusCode, 200)
  assert.deepEqual(logs.json(), { logs: 'registro de p' })
  assert.equal((await app.inject({ method: 'GET', url: '/api/projects/9/logs' })).statusCode, 404)
  await app.close()
})

test('elimina un proyecto y libera su nombre', async () => {
  const app = await testApp()
  await app.inject({ method: 'POST', url: '/api/projects', payload: repoProject })

  const removed = await app.inject({ method: 'DELETE', url: '/api/projects/1' })
  assert.equal(removed.statusCode, 204)
  assert.equal(removed.body, '')
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/projects' })).json(), [])
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/projects/1' })).statusCode, 404)
  assert.equal((await app.inject({ method: 'POST', url: '/api/projects', payload: repoProject })).statusCode, 201)
  await app.close()
})

test('si borrar falla, el proyecto sigue registrado para poder reintentar', async () => {
  const fake = fakeCore()
  const app = await testApp({
    ...fake.core,
    async removeProject() {
      throw new Error('Ejecuta en una terminal: sudo rm -rf /x')
    },
  })
  await app.inject({ method: 'POST', url: '/api/projects', payload: repoProject })
  const failed = await app.inject({ method: 'DELETE', url: '/api/projects/1' })
  assert.equal(failed.statusCode, 500)
  assert.match(failed.json().message, /sudo rm -rf/)
  assert.equal((await app.inject({ method: 'GET', url: '/api/projects/1' })).statusCode, 200)
  await app.close()
})

test('no elimina un proyecto que se está encendiendo y une los borrados repetidos', async () => {
  const fake = fakeCore()
  let finishStart: () => void = () => {}
  const starting = new Promise<void>((done) => { finishStart = done })
  let removals = 0
  const app = await testApp({
    ...fake.core,
    async startProject() {
      await starting
      return { state: 'running', ports: [] }
    },
    async removeProject() {
      removals++
      await new Promise((done) => setTimeout(done, 30))
    },
  })
  await app.inject({ method: 'POST', url: '/api/projects', payload: repoProject })
  const start = app.inject({ method: 'POST', url: '/api/projects/1/start' })
  await new Promise((done) => setTimeout(done, 20))
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/projects/1' })).statusCode, 409)
  finishStart()
  await start

  const responses = await Promise.all([
    app.inject({ method: 'DELETE', url: '/api/projects/1' }),
    app.inject({ method: 'DELETE', url: '/api/projects/1' }),
  ])
  assert.deepEqual(responses.map((response) => response.statusCode), [204, 204])
  assert.equal(removals, 1)
  await app.close()
})

test('todos los errores responden solo con message', async () => {
  const app = await testApp()
  const cases: [InjectOptions, number][] = [
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

test('comprueba la web solo si está encendido y con el puerto de Abrir', async () => {
  const fake = fakeCore()
  const ports: number[] = []
  const app = await testApp(
    {
      ...fake.core,
      async startProject() {
        return { state: 'running', ports: [3306, 8084] }
      },
    },
    async (port) => {
      ports.push(port)
      return { state: 'no-response' }
    },
  )
  await app.inject({ method: 'POST', url: '/api/projects', payload: repoProject })
  assert.equal((await app.inject({ method: 'GET', url: '/api/projects/1' })).json().web, null)
  assert.deepEqual(ports, [])

  const started = await app.inject({ method: 'POST', url: '/api/projects/1/start' })
  assert.deepEqual(started.json().web, { state: 'no-response' })
  assert.deepEqual(ports, [8084])
  await app.close()
})

test('sin puerto de página no comprueba la web', async () => {
  const fake = fakeCore()
  let calls = 0
  const app = await testApp(
    {
      ...fake.core,
      async startProject() {
        return { state: 'running', ports: [5432] }
      },
    },
    async () => {
      calls++
      return { state: 'ok' }
    },
  )
  await app.inject({ method: 'POST', url: '/api/projects', payload: repoProject })
  const started = await app.inject({ method: 'POST', url: '/api/projects/1/start' })
  assert.equal(started.json().web, null)
  assert.equal(calls, 0)
  await app.close()
})

test('la web que contesta no se vuelve a pedir enseguida; la que no contesta, sí', async () => {
  const statuses = new Map<string, ProjectStatus>()
  const fake = fakeCore()
  const core: CoreAdapter = {
    ...fake.core,
    async startProject(_dir, name) {
      const status: ProjectStatus = { state: 'running', ports: [8084] }
      statuses.set(name, status)
      return status
    },
    async getProjectStatus(name) {
      return statuses.get(name) ?? { state: 'stopped', ports: [] }
    },
    async getProjectStatuses() {
      return Object.fromEntries(statuses)
    },
  }
  let calls = 0
  let answer: 'ok' | 'no-response' = 'no-response'
  const app = await testApp(core, async () => {
    calls++
    return { state: answer }
  })
  await app.inject({ method: 'POST', url: '/api/projects', payload: repoProject })
  await app.inject({ method: 'POST', url: '/api/projects/1/start' })
  assert.equal(calls, 1)

  await app.inject({ method: 'GET', url: '/api/projects' })
  assert.equal(calls, 2)

  answer = 'ok'
  await app.inject({ method: 'GET', url: '/api/projects' })
  assert.equal(calls, 3)
  const cached = await app.inject({ method: 'GET', url: '/api/projects' })
  assert.equal(calls, 3)
  assert.deepEqual(cached.json()[0].web, { state: 'ok' })

  // Volver a encender descarta lo guardado.
  await app.inject({ method: 'POST', url: '/api/projects/1/start' })
  assert.equal(calls, 4)
  await app.close()
})

test('el comprobador distingue respuesta, error del servidor y falta de respuesta', async () => {
  let status = 200
  const server = createServer((_request, response) => {
    response.writeHead(status, status === 302 ? { location: 'http://localhost:1/' } : {})
    response.end('hola')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const check = createWebChecker('127.0.0.1')

  assert.deepEqual(await check(port), { state: 'ok', httpStatus: 200 })
  // No sigue la redirección, y un 404 también prueba que la aplicación está viva.
  status = 302
  assert.deepEqual(await check(port), { state: 'ok', httpStatus: 302 })
  status = 404
  assert.deepEqual(await check(port), { state: 'ok', httpStatus: 404 })
  status = 502
  assert.deepEqual(await check(port), { state: 'error', httpStatus: 502 })

  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  assert.deepEqual(await check(port), { state: 'no-response' })
})

test('guarda los avisos de la revisión y los devuelve sin impedir encender', async () => {
  const fake = fakeCore()
  const app = await testApp({
    ...fake.core,
    async reviewProject() {
      return ['Servicio web: usa privileged, que le da control total de la PC.']
    },
  })
  const created = await app.inject({ method: 'POST', url: '/api/projects', payload: repoProject })
  assert.equal(created.statusCode, 201)
  const warnings = ['Servicio web: usa privileged, que le da control total de la PC.']
  assert.deepEqual(created.json().warnings, warnings)
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/projects' })).json()[0].warnings, warnings)
  assert.equal((await app.inject({ method: 'POST', url: '/api/projects/1/start' })).statusCode, 200)
  await app.close()
})

test('una base creada antes de la revisión recibe la columna de avisos', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dockyard-db-'))
  const path = join(dir, 'app.db')
  const old = new DatabaseSync(path)
  old.exec(`CREATE TABLE projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, team TEXT NOT NULL,
    source_type TEXT NOT NULL, source TEXT NOT NULL, dir TEXT NOT NULL, created_at TEXT NOT NULL
  ) STRICT`)
  old.exec(`INSERT INTO projects (name, team, source_type, source, dir, created_at)
    VALUES ('viejo', 'E', 'git', 'https://github.com/e/p', '/p', '2026-01-01')`)
  old.close()

  const repository = createProjectRepository(path)
  assert.equal(repository.list()[0]?.warnings, '[]')
  assert.equal(repository.list()[0]?.keep_running, 0)
  assert.equal(repository.list()[0]?.notes, '')
  repository.close()
  await rm(dir, { recursive: true, force: true })
})

const HOUR = 60 * 60 * 1000

test('la versión: avisa solo si la etiqueta es posterior a la instalada', async () => {
  const check = (latest: string | null) =>
    createVersionChecker({ current: '1.0.0', enabled: true, fetchLatest: async () => latest })()

  assert.deepEqual({ ...(await check('v1.1.0')), checkedAt: null }, { current: '1.0.0', latest: 'v1.1.0', updateAvailable: true, checkedAt: null })
  assert.equal((await check('v1.0.0')).updateAvailable, false)
  assert.equal((await check('v0.9.0')).updateAvailable, false)
  assert.deepEqual({ ...(await check(null)), checkedAt: null }, { current: '1.0.0', latest: null, updateAvailable: false, checkedAt: null })
})

test('la versión: consulta como máximo cada 6 horas, aunque la pidan muchas veces a la vez', async () => {
  let calls = 0
  let time = 0
  const check = createVersionChecker({
    current: '1.0.0',
    enabled: true,
    now: () => time,
    fetchLatest: async () => `v1.0.${++calls}`,
  })

  assert.equal(calls, 0, 'no consulta hasta que se lo piden')
  const [first, second] = await Promise.all([check(), check()])
  assert.equal(calls, 1)
  assert.equal(first.latest, 'v1.0.1')
  assert.equal(second.latest, 'v1.0.1')

  time = 6 * HOUR - 1
  assert.equal((await check()).latest, 'v1.0.1')
  assert.equal(calls, 1)

  time = 6 * HOUR
  assert.equal((await check()).latest, 'v1.0.2')
  assert.equal(calls, 2)
})

test('la versión: sin internet no falla, conserva el último dato y no insiste', async () => {
  let online = true
  let calls = 0
  let time = 0
  const errors: unknown[] = []
  const check = createVersionChecker({
    current: '1.0.0',
    enabled: true,
    now: () => time,
    onError: (error) => errors.push(error),
    fetchLatest: async () => {
      calls++
      if (!online) throw new Error('sin conexión')
      return 'v1.1.0'
    },
  })

  await check()
  online = false
  time = 6 * HOUR
  assert.equal((await check()).updateAvailable, true, 'conserva lo último que supo')
  assert.equal(errors.length, 1)
  assert.equal(calls, 2)

  time += HOUR
  await check()
  assert.equal(calls, 2, 'una falla también espera 6 horas')

  const offline = createVersionChecker({
    current: '1.0.0',
    enabled: true,
    fetchLatest: async () => { throw new Error('sin conexión') },
  })
  assert.deepEqual(await offline(), { current: '1.0.0', latest: null, updateAvailable: false, checkedAt: null })
})

test('la versión: UPDATE_CHECK=off no se conecta nunca', async () => {
  let calls = 0
  const fetchLatest = async () => { calls++; return 'v9.0.0' }
  const before = process.env.UPDATE_CHECK
  try {
    for (const value of ['off', 'OFF', ' off ']) {
      process.env.UPDATE_CHECK = value
      assert.equal((await createVersionChecker({ current: '1.0.0', fetchLatest })()).updateAvailable, false)
    }
    assert.equal(calls, 0)
    process.env.UPDATE_CHECK = 'on'
    assert.equal((await createVersionChecker({ current: '1.0.0', fetchLatest })()).updateAvailable, true)
    assert.equal(calls, 1)
  } finally {
    if (before === undefined) delete process.env.UPDATE_CHECK
    else process.env.UPDATE_CHECK = before
  }
})

test('GET /api/version responde con la versión instalada de la raíz', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dockyard-api-version-'))
  const repository = createProjectRepository(join(dir, 'dockyard.db'))
  const app = await buildApp({
    repository,
    core: fakeCore().core,
    checkVersion: createVersionChecker({ enabled: true, fetchLatest: async () => 'v99.0.0' }),
  })
  try {
    const response = await app.inject({ method: 'GET', url: '/api/version', headers: { host: 'localhost:4300' } })
    assert.equal(response.statusCode, 200)
    const body = response.json()
    assert.match(body.current, /^\d+\.\d+\.\d+$/)
    assert.deepEqual({ latest: body.latest, updateAvailable: body.updateAvailable }, { latest: 'v99.0.0', updateAvailable: true })

    const foreign = await app.inject({ method: 'GET', url: '/api/version', headers: { host: 'evil.example' } })
    assert.equal(foreign.statusCode, 403)
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
