import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildApp } from '../src/app.ts'
import { createProjectRepository } from '../src/db/projects.ts'
import { createSettingsStore } from '../src/services/settings.ts'
import { createVersionChecker } from '../src/services/version.ts'
import type { CoreAdapter } from '../src/types.ts'

const HOST = { host: 'localhost:4300' }

interface FakeUpdate {
  supported: boolean
  running: boolean
  started: number
}

/** Solo lo que usan Configuración y la actualización; el resto no se llama en estas pruebas. */
function fakeCore(update: FakeUpdate): CoreAdapter {
  return {
    async getSelfUpdateStatus() {
      return { supported: update.supported, running: update.running }
    },
    async startSelfUpdate() {
      update.started++
      update.running = true
    },
  } as Partial<CoreAdapter> as CoreAdapter
}

/** App con el núcleo simulado y UPDATE_CHECK fijado. No consulta GitHub: estas pruebas no piden la versión. */
async function setup(options: { supported?: boolean; env?: string } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'dockyard-settings-'))
  const update: FakeUpdate = { supported: options.supported ?? true, running: false, started: 0 }
  const before = process.env.UPDATE_CHECK
  if (options.env !== undefined) process.env.UPDATE_CHECK = options.env
  else delete process.env.UPDATE_CHECK
  const app = await buildApp({ repository: createProjectRepository(':memory:'), core: fakeCore(update), dataDir })
  return {
    app,
    async close() {
      await app.close()
      await rm(dataDir, { recursive: true, force: true })
      if (before === undefined) delete process.env.UPDATE_CHECK
      else process.env.UPDATE_CHECK = before
    },
  }
}

test('Configuración: la consulta automática empieza según UPDATE_CHECK y luego manda lo guardado', async () => {
  const ctx = await setup({ env: 'off' })
  try {
    assert.deepEqual((await ctx.app.inject({ method: 'GET', url: '/api/settings', headers: HOST })).json(), { updateCheck: false, projectsView: 'grid' })

    const saved = await ctx.app.inject({ method: 'PATCH', url: '/api/settings', headers: HOST, payload: { updateCheck: true } })
    assert.equal(saved.statusCode, 200)
    assert.deepEqual(saved.json(), { updateCheck: true, projectsView: 'grid' })
    assert.deepEqual((await ctx.app.inject({ method: 'GET', url: '/api/settings', headers: HOST })).json(), { updateCheck: true, projectsView: 'grid' })

    for (const payload of [{}, { updateCheck: 'sí' }, { otro: true }, { projectsView: 'lista' }]) {
      const bad = await ctx.app.inject({ method: 'PATCH', url: '/api/settings', headers: HOST, payload })
      assert.equal(bad.statusCode, 400, JSON.stringify(payload))
    }
  } finally {
    await ctx.close()
  }
})

test('la vista de Proyectos: cuadrícula en una instalación nueva, tabla si ya había proyectos, y se guarda', async () => {
  const fresh = createProjectRepository(':memory:')
  const app = await buildApp({ repository: fresh, core: fakeCore({ supported: false, running: false, started: 0 }) })
  assert.equal((await app.inject({ method: 'GET', url: '/api/settings', headers: HOST })).json().projectsView, 'grid')
  // Registrar el primer proyecto no la cambia: quedó guardada al arrancar.
  fresh.insert({ name: 'primero', team: 'E', sourceType: 'git', source: 'https://github.com/e/p', dir: '/p', warnings: [] })
  assert.equal(createSettingsStore(fresh).get().projectsView, 'grid')
  const saved = await app.inject({ method: 'PATCH', url: '/api/settings', headers: HOST, payload: { projectsView: 'table' } })
  assert.equal(saved.json().projectsView, 'table')
  assert.equal((await app.inject({ method: 'GET', url: '/api/settings', headers: HOST })).json().projectsView, 'table')
  await app.close()

  const existing = createProjectRepository(':memory:')
  existing.insert({ name: 'viejo', team: 'E', sourceType: 'git', source: 'https://github.com/e/p', dir: '/p', warnings: [] })
  assert.equal(createSettingsStore(existing).get().projectsView, 'table')
})

test('la consulta automática obedece al ajuste en cada llamada; Comprobar ahora consulta siempre', async () => {
  let calls = 0
  let enabled = false
  let online = true
  const check = createVersionChecker({
    current: '1.0.0',
    enabled: () => enabled,
    now: () => 1_000,
    fetchLatest: async () => {
      calls++
      if (!online) throw new Error('sin conexión')
      return 'v1.1.0'
    },
  })

  assert.equal((await check()).latest, null)
  assert.equal(calls, 0, 'apagada no consulta')

  const now = await check.checkNow()
  assert.equal(calls, 1)
  assert.deepEqual(now, { current: '1.0.0', latest: 'v1.1.0', updateAvailable: true, checkedAt: new Date(1_000).toISOString() })

  enabled = true
  await check()
  assert.equal(calls, 1, 'Comprobar ahora también cuenta para las 6 horas')

  online = false
  await assert.rejects(check.checkNow(), (error: Error) => {
    assert.match(error.message, /No se pudo consultar GitHub/)
    return true
  })
  assert.equal((await check()).latest, 'v1.1.0', 'conserva lo último que supo')
})

test('POST /api/version/check responde 502 si GitHub no responde', async () => {
  const repository = createProjectRepository(':memory:')
  const app = await buildApp({
    repository,
    core: fakeCore({ supported: true, running: false, started: 0 }),
    checkVersion: createVersionChecker({ current: '1.0.0', fetchLatest: async () => { throw new Error('sin red') } }),
  })
  try {
    const response = await app.inject({ method: 'POST', url: '/api/version/check', headers: HOST })
    assert.equal(response.statusCode, 502)
    assert.match(response.json().message, /No se pudo consultar GitHub/)
  } finally {
    await app.close()
  }
})

test('actualizar: solo con una versión nueva, sin operaciones en curso, y lee el resultado de update.sh', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'dockyard-update-'))
  const update: FakeUpdate = { supported: true, running: false, started: 0 }
  let latest = 'v1.0.0'
  const repository = createProjectRepository(':memory:')
  const app = await buildApp({
    repository,
    core: fakeCore(update),
    dataDir,
    checkVersion: createVersionChecker({ current: '1.0.0', enabled: true, now: () => 0, fetchLatest: async () => latest }),
  })
  try {
    assert.deepEqual((await app.inject({ method: 'GET', url: '/api/update', headers: HOST })).json(), { supported: true, running: false, last: null })

    const current = await app.inject({ method: 'POST', url: '/api/update', headers: HOST })
    assert.equal(current.statusCode, 409)
    assert.match(current.json().message, /Ya tienes la última versión/)
    assert.equal(update.started, 0)

    latest = 'v1.1.0'
    await app.inject({ method: 'POST', url: '/api/version/check', headers: HOST })
    const started = await app.inject({ method: 'POST', url: '/api/update', headers: HOST })
    assert.equal(started.statusCode, 202)
    assert.equal(started.json().running, true)
    assert.equal(update.started, 1)

    // Mientras corre, update.sh ya escribió algo pero aún no su código de salida.
    await writeFile(join(dataDir, 'actualizacion.log'), 'Buscando una versión nueva\n')
    const running = (await app.inject({ method: 'GET', url: '/api/update', headers: HOST })).json()
    assert.deepEqual(running.last, { exitCode: null, finishedAt: null, log: 'Buscando una versión nueva' })

    update.running = false
    await writeFile(join(dataDir, 'actualizacion.log'), `${Array.from({ length: 100 }, (_, i) => `línea ${i}`).join('\n')}\n✘ Hay archivos modificados\n`)
    await writeFile(join(dataDir, 'actualizacion.estado'), '1\n')
    const failed = (await app.inject({ method: 'GET', url: '/api/update', headers: HOST })).json()
    assert.equal(failed.last.exitCode, 1)
    assert.match(failed.last.finishedAt, /^\d{4}-\d\d-\d\dT/)
    assert.equal(failed.last.log.split('\n').length, 80, 'solo las últimas líneas')
    assert.match(failed.last.log, /✘ Hay archivos modificados$/)
  } finally {
    await app.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('actualizar: se niega si se cortaría un registro en curso', async () => {
  const update: FakeUpdate = { supported: true, running: false, started: 0 }
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  const core = {
    ...fakeCore(update),
    normalizeProjectName: (name: string) => name.toLowerCase(),
    async prepareProject(_source: unknown, name: string) {
      await gate
      return { dir: `/projects/${name}`, name }
    },
    async reviewProject() { return [] },
    async getProjectStatus() { return { state: 'stopped' as const, ports: [] } },
  } as Partial<CoreAdapter> as CoreAdapter
  const app = await buildApp({
    repository: createProjectRepository(':memory:'),
    core,
    checkVersion: createVersionChecker({ current: '1.0.0', enabled: true, fetchLatest: async () => 'v2.0.0' }),
  })
  try {
    const pending = app.inject({ method: 'POST', url: '/api/projects', headers: HOST, payload: { team: 'E', name: 'tienda', repoUrl: 'https://github.com/e/t' } })
    for (let i = 0; i < 50; i++) {
      if ((await app.inject({ method: 'GET', url: '/api/registrations', headers: HOST })).json().length > 0) break
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    const refused = await app.inject({ method: 'POST', url: '/api/update', headers: HOST })
    assert.equal(refused.statusCode, 409)
    assert.match(refused.json().message, /registrándose/)
    assert.equal(update.started, 0)
    release()
    assert.equal((await pending).statusCode, 201)
    assert.equal((await app.inject({ method: 'POST', url: '/api/update', headers: HOST })).statusCode, 202)
  } finally {
    await app.close()
  }
})

test('actualizar: sin instalación con install.sh no se lee ningún resultado', async () => {
  const ctx = await setup({ supported: false })
  try {
    assert.deepEqual((await ctx.app.inject({ method: 'GET', url: '/api/update', headers: HOST })).json(), { supported: false, running: false, last: null })
  } finally {
    await ctx.close()
  }
})
