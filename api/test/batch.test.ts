// Registrar varios proyectos a la vez: la API encola los válidos y los prepara de a uno.
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildApp } from '../src/app.ts'
import type { ProjectStatus } from '../src/core.ts'
import { createProjectRepository } from '../src/db/projects.ts'
import type { CoreAdapter } from '../src/types.ts'

const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')

/** Núcleo simulado que deja controlar cuándo termina cada descarga y cuántas corren a la vez. */
function slowCore(failing = new Set<string>()) {
  const started: string[] = []
  const pending: (() => void)[] = []
  let running = 0
  let maxRunning = 0
  const core = {
    normalizeProjectName: normalize,
    async prepareProject(source: { url?: string }, name: string) {
      started.push(name)
      running++
      maxRunning = Math.max(maxRunning, running)
      await new Promise<void>((resolve) => pending.push(resolve))
      running--
      if (failing.has(name)) throw new Error(`No se pudo clonar ${source.url}.`)
      return { dir: `/projects/${normalize(name)}`, name: normalize(name) }
    },
    async reviewProject() {
      return []
    },
    async getProjectStatus(): Promise<ProjectStatus> {
      return { state: 'stopped', ports: [] }
    },
    async getProjectStatuses() {
      return {}
    },
  } as Partial<CoreAdapter> as CoreAdapter
  /** Deja terminar la descarga en curso y espera a que la cola siga. */
  async function finishOne(): Promise<void> {
    for (let i = 0; i < 50 && pending.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 5))
    pending.shift()?.()
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return { core, started, finishOne, maxRunning: () => maxRunning }
}

const item = (team: string, name: string, repoUrl = `https://github.com/e/${name}`) => ({ team, name, repoUrl })

test('una tanda registra solo las líneas válidas, en orden y de a una', async () => {
  const fake = slowCore(new Set(['falla']))
  const repository = createProjectRepository(':memory:')
  repository.insert({ name: 'ya-existe', team: 'E', sourceType: 'git', source: 'x', dir: '/x', warnings: [] })
  const app = await buildApp({ repository, core: fake.core, checkWeb: async () => ({ state: 'ok' }) })

  const response = await app.inject({
    method: 'POST',
    url: '/api/projects/batch',
    payload: {
      year: 2025,
      items: [
        item('Equipo 1', 'Tienda'),
        item('Equipo 2', 'ya-existe'),
        item('Equipo 3', 'Huerto', 'http://github.com/e/huerto'),
        item('Equipo 4', 'tienda'),
        item('Equipo 5', 'falla'),
        item('Equipo 6', 'Agenda'),
      ],
    },
  })
  assert.equal(response.statusCode, 202)
  const body = response.json()
  assert.deepEqual(body.queued, ['tienda', 'falla', 'agenda'])
  assert.deepEqual(body.rejected.map((r: { index: number }) => r.index), [1, 2, 3])
  assert.match(body.rejected[0].message, /Ya existe un proyecto con el nombre “ya-existe”/)
  assert.match(body.rejected[1].message, /HTTPS de GitHub/)
  assert.match(body.rejected[2].message, /Ya se está registrando/)

  // Todos figuran enseguida; el primero empieza y los demás esperan.
  const registrations = (await app.inject({ method: 'GET', url: '/api/registrations' })).json()
  assert.equal(registrations.length, 3)
  assert.deepEqual(registrations.filter((r: { stage: string }) => r.stage === 'En espera').map((r: { name: string }) => r.name).sort(), ['agenda', 'falla'])

  for (let i = 0; i < 3; i++) await fake.finishOne()
  assert.deepEqual(fake.started, ['Tienda', 'falla', 'Agenda'])
  assert.equal(fake.maxRunning(), 1, 'de a uno')

  const projects = (await app.inject({ method: 'GET', url: '/api/projects?year=2025' })).json()
  assert.deepEqual(projects.map((p: { name: string }) => p.name).sort(), ['agenda', 'tienda'])
  // El que falló queda en la lista con su motivo, porque nadie esperaba la respuesta.
  const left = (await app.inject({ method: 'GET', url: '/api/registrations' })).json()
  assert.deepEqual(left.map((r: { name: string; error: string }) => [r.name, r.error]), [['falla', 'No se pudo clonar https://github.com/e/falla.']])
  await app.close()
})

test('mientras la tanda corre, Dockyard está ocupado y el nombre queda reservado', async () => {
  const fake = slowCore()
  const app = await buildApp({ repository: createProjectRepository(':memory:'), core: fake.core, checkWeb: async () => ({ state: 'ok' }) })
  await app.inject({ method: 'POST', url: '/api/projects/batch', payload: { items: [item('E', 'uno'), item('E', 'dos')] } })
  const single = await app.inject({ method: 'POST', url: '/api/projects', payload: { team: 'E', name: 'dos', repoUrl: 'https://github.com/e/dos' } })
  assert.equal(single.statusCode, 409)
  const clean = await app.inject({ method: 'POST', url: '/api/disk/clean' })
  assert.equal(clean.statusCode, 409, 'busy() cuenta los registros en espera')
  await fake.finishOne()
  await fake.finishOne()
  assert.equal((await app.inject({ method: 'GET', url: '/api/registrations' })).json().length, 0)
  await app.close()
})

test('una tanda vacía, demasiado larga o con campos de más no se acepta', async () => {
  const app = await buildApp({ repository: createProjectRepository(':memory:'), core: slowCore().core, checkWeb: async () => ({ state: 'ok' }) })
  const bad = [
    { items: [] },
    { items: Array.from({ length: 61 }, (_, i) => item('E', `p${i}`)) },
    { items: [{ ...item('E', 'a'), extra: 1 }] },
    { items: [item('E', 'a')], year: 1990 },
    { items: [{ team: '', name: 'a', repoUrl: 'https://github.com/e/a' }] },
  ]
  for (const payload of bad) {
    assert.equal((await app.inject({ method: 'POST', url: '/api/projects/batch', payload })).statusCode, 400, JSON.stringify(payload).slice(0, 80))
  }
  await app.close()
})
