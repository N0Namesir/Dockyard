import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { chromium } from 'playwright'

// Solo se sirve el frontend compilado. Todas las rutas API están interceptadas.
let browser, server, base
const root = resolve(import.meta.dirname, '../dist')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json' }

before(async () => {
  server = createServer(async (req, res) => {
    try {
      const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'))
      if (!path.startsWith(root + '/')) { res.writeHead(403).end(); return }
      const data = await readFile(path)
      res.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream')
      res.end(data)
    } catch { res.writeHead(404).end() }
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  base = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch({ headless: true })
})
after(async () => { await browser?.close(); await new Promise((done) => server?.close(done)) })

async function fixture(t, state) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
  t.after(() => page.close())
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  t.after(() => assert.deepEqual(errors, []))
  const calls = []
  await page.route('**/api/**', async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname
    calls.push(`${req.method()} ${path}`)
    const json = (body, status = 200) => route.fulfill({ status, json: body })
    if (state.down?.()) return route.abort('connectionrefused')
    if (path === '/api/version' && req.method() === 'GET') return json(state.version)
    if (path === '/api/version/check') { state.version = { ...state.version, ...state.onCheck }; return json(state.version) }
    if (path === '/api/settings' && req.method() === 'GET') return json(state.settings)
    if (path === '/api/settings') { state.settings = { ...state.settings, ...req.postDataJSON() }; return json(state.settings) }
    if (path === '/api/update' && req.method() === 'GET') return json(state.update)
    if (path === '/api/update') { state.update = { ...state.update, running: true }; state.onStart?.(); return json(state.update, 202) }
    if (path === '/api/disk' && req.method() === 'GET') return json(state.disk ?? { total: { imageBytes: 0, unusedImageBytes: 0, volumeBytes: 0 }, projects: [] })
    if (path === '/api/disk/clean') return state.onClean ? state.onClean(route) : json({ freedBytes: 0, removed: 0 })
    if (path === '/api/import/pending' && req.method() === 'GET') return json(state.pending ?? [])
    if (path.startsWith('/api/import/pending/')) { state.pending = (state.pending ?? []).filter((p) => !path.endsWith('/' + p.name)); return json({ id: 9 }, req.method() === 'DELETE' ? 200 : 201) }
    if (path === '/api/import/preview') return json({ projects: state.plan ?? [] })
    if (path === '/api/import') { state.imported = req.postDataJSON(); state.pending = state.afterImport ?? []; return json(state.importResult) }
    return json({ message: 'Ruta no prevista en prueba' }, 404)
  })
  await page.goto(base + '/configuracion/')
  await page.locator('#version-current').filter({ hasText: 'v1.2.0' }).waitFor()
  return { page, calls }
}

const VERSION = { current: '1.2.0', latest: 'v1.2.0', updateAvailable: false, checkedAt: '2026-11-18T05:00:00.000Z' }

test('muestra las versiones, comprueba ahora y guarda la consulta automática', async (t) => {
  const state = {
    version: VERSION,
    settings: { updateCheck: true },
    update: { supported: true, running: false, last: null },
    onCheck: { latest: 'v1.3.0', updateAvailable: true },
  }
  const { page, calls } = await fixture(t, state)
  assert.equal(await page.locator('#version-latest').innerText(), 'v1.2.0')
  assert.equal(await page.locator('#update-box').isHidden(), true)
  assert.equal(await page.locator('header a[aria-current=page]').innerText(), 'Configuración')

  await page.locator('#check-now').click()
  await page.locator('#check-message').filter({ hasText: 'Hay una versión nueva.' }).waitFor()
  await page.locator('#update-box').waitFor()
  assert.equal(await page.locator('#update-version').innerText(), 'v1.3.0')
  assert.equal(await page.locator('#update-notes').getAttribute('href'), 'https://github.com/N0Namesir/Dockyard/releases/tag/v1.3.0')

  await page.locator('#update-check').uncheck()
  await page.waitForFunction(() => !document.querySelector('#update-check').disabled)
  assert.deepEqual(state.settings, { updateCheck: false })
  assert.ok(calls.includes('PATCH /api/settings'))
})

test('actualizar: confirma, espera mientras Dockyard se reinicia y recarga con la versión nueva', async (t) => {
  let restarting = 0
  const state = {
    version: { ...VERSION, latest: 'v1.3.0', updateAvailable: true },
    settings: { updateCheck: true },
    update: { supported: true, running: false, last: null },
    // Tras empezar, la API deja de responder unas consultas y vuelve con la versión nueva.
    onStart: () => { restarting = 2 },
    down: () => restarting > 0 && restarting-- > 0,
  }
  const { page } = await fixture(t, state)
  await page.locator('#update-now').click()
  await page.locator('#confirm-dialog').waitFor()
  assert.match(await page.locator('#confirm-dialog-title').innerText(), /v1\.3\.0/)
  await page.locator('#confirm-dialog-confirm').click()
  await page.locator('#update-running').waitFor()
  assert.equal(await page.locator('#update-box').isHidden(), true)
  assert.equal(await page.locator('#check-now').isDisabled(), true)

  state.version = { current: '1.3.0', latest: 'v1.3.0', updateAvailable: false, checkedAt: VERSION.checkedAt }
  state.update = { supported: true, running: false, last: { exitCode: 0, finishedAt: '2026-11-18T06:00:00.000Z', log: '✔ Dockyard 1.3.0 está disponible' } }
  await page.locator('#update-running-text').filter({ hasText: 'se actualizó a la v1.3.0' }).waitFor({ timeout: 15_000 })
  await page.waitForEvent('load', { timeout: 10_000 })
  await page.locator('#version-current').filter({ hasText: 'v1.3.0' }).waitFor()
  await page.locator('#update-result').filter({ hasText: 'terminó bien' }).waitFor()
})

test('actualizar: si update.sh falla, muestra la causa y Dockyard sigue igual', async (t) => {
  const state = {
    version: { ...VERSION, latest: 'v1.3.0', updateAvailable: true },
    settings: { updateCheck: true },
    update: { supported: true, running: false, last: null },
    onStart: () => {
      setTimeout(() => {
        state.update = { supported: true, running: false, last: { exitCode: 1, finishedAt: '2026-11-18T06:00:00.000Z', log: 'Docker: 29\n✘ Hay archivos de Dockyard modificados en esta PC' } }
      }, 500)
    },
  }
  const { page } = await fixture(t, state)
  await page.locator('#update-now').click()
  await page.locator('#confirm-dialog-confirm').click()
  await page.locator('#update-result').filter({ hasText: 'No se pudo actualizar' }).waitFor({ timeout: 15_000 })
  assert.equal(await page.locator('#update-log-box').evaluate((e) => e.open), true)
  assert.match(await page.locator('#update-log').innerText(), /archivos de Dockyard modificados/)
  assert.equal(await page.locator('#update-running').isHidden(), true)
  await page.locator('#update-box').waitFor()
})

test('sin instalación con install.sh, explica cómo actualizar desde la terminal', async (t) => {
  const state = {
    version: { ...VERSION, latest: 'v1.3.0', updateAvailable: true },
    settings: { updateCheck: false },
    update: { supported: false, running: false, last: null },
  }
  const { page } = await fixture(t, state)
  await page.locator('#update-box').waitFor()
  assert.equal(await page.locator('#update-now').isHidden(), true)
  assert.match(await page.locator('#update-unsupported').innerText(), /\.\/update\.sh/)
  assert.equal(await page.locator('#update-check').isChecked(), false)
})

test('espacio en disco: muestra cada proyecto y libera con una confirmación', async (t) => {
  const GB = 1024 ** 3
  const state = {
    version: VERSION,
    settings: { updateCheck: true },
    update: { supported: true, running: false, last: null },
    disk: {
      total: { imageBytes: 2 * GB, unusedImageBytes: 1.5 * GB, volumeBytes: 300 * 1024 ** 2 },
      projects: [
        { id: 2, name: 'tienda', imageBytes: 2 * GB, unusedImageBytes: 1.5 * GB, volumeBytes: 300 * 1024 ** 2 },
        { id: 1, name: 'biblioteca', imageBytes: 0, unusedImageBytes: 0, volumeBytes: 0 },
      ],
    },
  }
  state.onClean = (route) => {
    state.disk = { ...state.disk, total: { ...state.disk.total, unusedImageBytes: 0 }, projects: state.disk.projects.map((p) => ({ ...p, unusedImageBytes: 0 })) }
    return route.fulfill({ status: 200, json: { freedBytes: 1.4 * GB, removed: 3 } })
  }
  const { page, calls } = await fixture(t, state)
  await page.locator('#disk-total').filter({ hasText: 'ocupan 3.8 GB' }).waitFor()
  assert.deepEqual(await page.locator('#disk-rows tr').first().locator('td').allInnerTexts(), ['tienda', '2.0 GB', '1.5 GB', '300 MB'])
  assert.equal(await page.locator('#disk-rows tr').count(), 2)

  await page.locator('#disk-clean').click()
  await page.locator('#confirm-dialog').waitFor()
  assert.match(await page.locator('#confirm-dialog-text').innerText(), /unos 1.5 GB/)
  await page.locator('#confirm-dialog-cancel').click()
  assert.ok(!calls.includes('POST /api/disk/clean'), 'cancelar no libera nada')

  await page.locator('#disk-clean').click()
  await page.locator('#confirm-dialog-confirm').click()
  await page.locator('#disk-message').filter({ hasText: 'Se liberaron 1.4 GB (3 imágenes).' }).waitFor()
  await page.waitForFunction(() => document.querySelector('#disk-clean').disabled)
  assert.ok(calls.includes('POST /api/disk/clean'))
})

test('espacio en disco: si la API se niega, muestra el motivo', async (t) => {
  const state = {
    version: VERSION,
    settings: { updateCheck: true },
    update: { supported: true, running: false, last: null },
    disk: { total: { imageBytes: 0, unusedImageBytes: 5e8, volumeBytes: 0 }, projects: [{ id: 1, name: 'tienda', imageBytes: 0, unusedImageBytes: 5e8, volumeBytes: 0 }] },
    onClean: (route) => route.fulfill({ status: 409, json: { message: 'Hay proyectos encendiéndose, actualizándose o registrándose. Espera a que terminen para liberar espacio.' } }),
  }
  const { page } = await fixture(t, state)
  await page.locator('#disk-clean:enabled').click()
  await page.locator('#confirm-dialog-confirm').click()
  await page.locator('#disk-message').filter({ hasText: 'Espera a que terminen' }).waitFor()
})

test('respaldo: exportar descarga la lista; importar muestra la vista previa y los ZIP pendientes', async (t) => {
  const file = { format: 1, dockyard: '1.3.3', exportedAt: '2026-11-18T00:00:00.000Z', projects: [
    { name: 'tienda', displayName: 'Tienda escolar', team: 'Equipo 1', year: 2025, sourceType: 'git', repoUrl: 'https://github.com/e/tienda' },
    { name: 'agenda', team: 'Equipo 2', year: 2026, sourceType: 'zip', zipName: 'agenda.zip' },
    { name: 'biblioteca', team: 'Equipo 3', sourceType: 'git', repoUrl: 'https://github.com/e/b' },
  ] }
  const state = {
    version: VERSION,
    settings: { updateCheck: true },
    update: { supported: true, running: false, last: null },
    plan: [
      { name: 'tienda', displayName: 'Tienda escolar', team: 'Equipo 1', year: 2025, sourceType: 'git', action: 'register', reason: null },
      { name: 'agenda', displayName: 'agenda', team: 'Equipo 2', year: 2026, sourceType: 'zip', action: 'needs-zip', reason: null },
      { name: 'biblioteca', displayName: 'biblioteca', team: 'Equipo 3', year: null, sourceType: 'git', action: 'skip', reason: 'Ya existe un proyecto con ese nombre.' },
    ],
    importResult: { queued: ['tienda'], needsZip: ['agenda'], skipped: [{ name: 'biblioteca', reason: 'Ya existe un proyecto con ese nombre.' }] },
    afterImport: [{ name: 'agenda', displayName: 'agenda', team: 'Equipo 2', year: 2026, zipName: 'agenda.zip', hasImage: false }],
  }
  const { page, calls } = await fixture(t, state)
  const exportLink = page.locator('#export-list')
  assert.equal(await exportLink.getAttribute('href'), '/api/export')
  assert.equal(await exportLink.getAttribute('download'), '')
  assert.match(await page.locator('#backup').innerText(), /datos de contacto de los estudiantes/)

  await page.locator('#import-file').setInputFiles({ name: 'dockyard-proyectos-2026-11-18.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) })
  await page.locator('#import-preview tr').first().waitFor()
  assert.deepEqual(await page.locator('#import-preview tr td:last-child').allInnerTexts(), [
    'Se registra desde GitHub, con su ficha',
    'Necesita su ZIP: lo eliges después',
    'Se omite: Ya existe un proyecto con ese nombre.',
  ])
  assert.ok(!calls.includes('POST /api/import'), 'la vista previa no importa nada')
  assert.equal(await page.locator('#import-apply').innerText(), 'Importar 2 proyectos')
  await page.locator('#import-apply').click()
  await page.locator('#import-message').filter({ hasText: '1 proyecto de GitHub se registra de a uno' }).waitFor()
  assert.deepEqual(state.imported, file)
  assert.match(await page.locator('#import-message').innerText(), /1 espera su ZIP.*Se omitió biblioteca/)
  assert.equal(await page.locator('#import-preview-box').isHidden(), true)

  const pending = page.locator('#pending-list li')
  await pending.first().waitFor()
  assert.match(await pending.first().innerText(), /Equipo 2 · 2026 · antes: agenda\.zip/)
  const chooser = page.waitForEvent('filechooser')
  await pending.first().getByRole('button', { name: 'Elegir ZIP y registrar' }).click()
  await (await chooser).setFiles({ name: 'agenda.zip', mimeType: 'application/zip', buffer: Buffer.from('zip') })
  await page.locator('#import-message').filter({ hasText: 'Se registró agenda con su ficha.' }).waitFor()
  assert.ok(calls.includes('POST /api/import/pending/agenda'))
  await page.locator('#pending-box').waitFor({ state: 'hidden' })
})

test('respaldo: un archivo que no es JSON se explica sin llamar a la API', async (t) => {
  const state = { version: VERSION, settings: { updateCheck: true }, update: { supported: true, running: false, last: null } }
  const { page, calls } = await fixture(t, state)
  await page.locator('#import-file').setInputFiles({ name: 'notas.json', mimeType: 'application/json', buffer: Buffer.from('no es json') })
  await page.locator('#import-message').filter({ hasText: 'no es una lista exportada por Dockyard' }).waitFor()
  assert.ok(!calls.some((call) => call.includes('/api/import/preview')))
})
