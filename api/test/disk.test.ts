import assert from 'node:assert/strict'
import test from 'node:test'
import { buildApp } from '../src/app.ts'
import type { DiskUsage, ProjectStatus } from '../src/core.ts'
import { createProjectRepository } from '../src/db/projects.ts'
import type { CoreAdapter } from '../src/types.ts'

const STOPPED: ProjectStatus = { state: 'stopped', ports: [] }

/** Solo lo que usan Espacio en disco y encender; el resto no se llama en estas pruebas. */
function fakeCore(usage: DiskUsage, overrides: Partial<CoreAdapter> = {}) {
  const pruned: string[][] = []
  const core = {
    async getDiskUsage() {
      return usage
    },
    async pruneProjectImages(names: string[]) {
      pruned.push(names)
      return { freedBytes: 1_500_000_000, removed: 3 }
    },
    async getProjectStatus() {
      return STOPPED
    },
    async getProjectStatuses() {
      return {}
    },
    ...overrides,
  } as Partial<CoreAdapter> as CoreAdapter
  return { core, pruned }
}

async function setup(usage: DiskUsage, overrides: Partial<CoreAdapter> = {}) {
  const repository = createProjectRepository(':memory:')
  for (const name of ['tienda', 'biblioteca']) {
    repository.insert({ name, team: 'E', sourceType: 'git', source: `https://github.com/e/${name}`, dir: `/projects/${name}`, warnings: [] })
  }
  const { core, pruned } = fakeCore(usage, overrides)
  const app = await buildApp({ repository, core, checkWeb: async () => ({ state: 'ok' }) })
  return { app, pruned }
}

test('el espacio en disco solo muestra los registrados, con el total y el más pesado primero', async () => {
  const { app } = await setup({
    projects: {
      tienda: { imageBytes: 100, unusedImageBytes: 50, volumeBytes: 10 },
      biblioteca: { imageBytes: 900, unusedImageBytes: 0, volumeBytes: 0 },
      'otro-de-la-pc': { imageBytes: 5000, unusedImageBytes: 5000, volumeBytes: 5000 },
    },
  })
  const disk = (await app.inject({ method: 'GET', url: '/api/disk' })).json()
  assert.deepEqual(disk.total, { imageBytes: 1000, unusedImageBytes: 50, volumeBytes: 10 })
  assert.deepEqual(disk.projects.map((p: { name: string }) => p.name), ['biblioteca', 'tienda'])
  assert.deepEqual(disk.projects[1], { id: 1, name: 'tienda', imageBytes: 100, unusedImageBytes: 50, volumeBytes: 10 })
  await app.close()
})

test('un registrado sin imágenes ni volúmenes aparece en cero', async () => {
  const { app } = await setup({ projects: {} })
  const disk = (await app.inject({ method: 'GET', url: '/api/disk' })).json()
  assert.equal(disk.projects.length, 2)
  assert.deepEqual(disk.total, { imageBytes: 0, unusedImageBytes: 0, volumeBytes: 0 })
  await app.close()
})

test('liberar espacio pide al núcleo solo los proyectos registrados', async () => {
  const { app, pruned } = await setup({ projects: {} })
  const response = await app.inject({ method: 'POST', url: '/api/disk/clean' })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), { freedBytes: 1_500_000_000, removed: 3 })
  assert.deepEqual(pruned, [['biblioteca', 'tienda']])
  await app.close()
})

test('liberar espacio se niega mientras un proyecto se enciende', async () => {
  let finish = () => {}
  const { app, pruned } = await setup({ projects: {} }, {
    async startProject() {
      await new Promise<void>((resolve) => { finish = resolve })
      return { state: 'running', ports: [] }
    },
  })
  const starting = app.inject({ method: 'POST', url: '/api/projects/1/start' })
  await new Promise((resolve) => setTimeout(resolve, 20))
  const busy = await app.inject({ method: 'POST', url: '/api/disk/clean' })
  assert.equal(busy.statusCode, 409)
  assert.match(busy.json().message, /Espera a que terminen/)
  finish()
  await starting
  assert.equal((await app.inject({ method: 'POST', url: '/api/disk/clean' })).statusCode, 200)
  assert.equal(pruned.length, 1)
  await app.close()
})

test('sin proyectos registrados no pregunta a Docker', async () => {
  let asked = 0
  const repository = createProjectRepository(':memory:')
  const { core } = fakeCore({ projects: {} }, {
    async getDiskUsage() {
      asked++
      return { projects: {} }
    },
    async pruneProjectImages() {
      asked++
      return { freedBytes: 0, removed: 0 }
    },
  })
  const app = await buildApp({ repository, core, checkWeb: async () => ({ state: 'ok' }) })
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/disk' })).json(), {
    total: { imageBytes: 0, unusedImageBytes: 0, volumeBytes: 0 },
    projects: [],
  })
  assert.deepEqual((await app.inject({ method: 'POST', url: '/api/disk/clean' })).json(), { freedBytes: 0, removed: 0 })
  assert.equal(asked, 0)
  await app.close()
})
