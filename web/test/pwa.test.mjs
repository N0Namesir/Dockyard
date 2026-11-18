import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { chromium } from 'playwright'

const root = resolve(import.meta.dirname, '../dist')
let browser, server, base
let unavailable = false
let mutations = 0
let projects = []

before(async () => {
  server = createServer(async (req, res) => {
    if (unavailable) { res.writeHead(503).end('Servicio detenido'); return }
    const path = new URL(req.url, 'http://localhost').pathname
    if (path.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json')
      if (req.method !== 'GET') { mutations++; res.end('{}'); return }
      const body = path === '/api/projects' ? projects
        : path === '/api/version' ? { current: '1.2.0', updateAvailable: false, latest: null }
        : []
      res.end(JSON.stringify(body))
      return
    }
    try {
      const file = resolve(root, '.' + path.replace(/\/$/, '/index.html'))
      if (!file.startsWith(root + '/')) { res.writeHead(403).end(); return }
      const data = await readFile(file)
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }
      res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream')
      res.end(data)
    } catch { res.writeHead(404).end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch({ headless: true })
})
after(async () => {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
})

async function fixture(t) {
  unavailable = false
  projects = []
  const context = await browser.newContext()
  t.after(async () => { unavailable = false; await context.close() })
  const page = await context.newPage()
  await page.goto(base)
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
  return { context, page }
}

test('manifiesto válido, iconos y elegibilidad de instalación en Chromium', async t => {
  const { page } = await fixture(t)
  const cdp = await page.context().newCDPSession(page)
  const manifest = await cdp.send('Page.getAppManifest')
  assert.deepEqual(manifest.errors, [])
  const data = JSON.parse(manifest.data)
  assert.equal(data.id, '/')
  assert.equal(data.start_url, '/')
  assert.equal(data.scope, '/')
  assert.equal(data.display, 'standalone')
  for (const icon of data.icons) {
    const buffer = await readFile(resolve(root, '.' + icon.src))
    const [width, height] = icon.sizes.split('x').map(Number)
    assert.equal(buffer.readUInt32BE(16), width)
    assert.equal(buffer.readUInt32BE(20), height)
  }
  const result = await cdp.send('Page.getInstallabilityErrors')
  assert.deepEqual(result.installabilityErrors, [])
})

test('servicio detenido muestra ayuda y permite volver al aula al recuperarse', async t => {
  const { page } = await fixture(t)
  unavailable = true
  await page.reload()
  await page.getByRole('heading', { name: 'Dockyard no está disponible' }).waitFor()
  assert.equal(await page.getByRole('link', { name: 'Volver a intentar' }).count(), 1)
  if (process.env.UI_SCREENSHOTS) await page.screenshot({ path: resolve(process.env.UI_SCREENSHOTS, 'dockyard-sin-servicio.png'), fullPage: true })
  await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0))
  unavailable = false
  await page.getByRole('link', { name: 'Volver a intentar' }).click()
  await page.getByRole('heading', { name: 'Proyectos del aula' }).waitFor()
})

test('sin conexión no sirve datos antiguos ni encola operaciones', async t => {
  const { context, page } = await fixture(t)
  projects = [{ id: 99, name: 'dato-de-prueba' }]
  assert.equal(await page.evaluate(async () => (await (await fetch('/api/projects')).json())[0].id), 99)
  const before = mutations
  await context.setOffline(true)
  const result = await page.evaluate(async () => {
    const failed = async (path, method) => {
      try { await fetch(path, { method }); return false } catch { return true }
    }
    return { read: await failed('/api/projects', 'GET'), write: await failed('/api/projects/99/start', 'POST') }
  })
  assert.deepEqual(result, { read: true, write: true })
  await page.reload()
  await page.getByRole('heading', { name: 'Dockyard no está disponible' }).waitFor()
  const entries = await page.evaluate(async () => {
    const keys = await caches.keys()
    return (await Promise.all(keys.map(async key => (await (await caches.open(key)).keys()).map(req => new URL(req.url).pathname)))).flat().sort()
  })
  assert.deepEqual(entries, ['/favicon.svg', '/marca/ds-insamt.png', '/offline.html'].sort())
  await context.setOffline(false)
  projects = []
  await page.getByRole('link', { name: 'Volver a intentar' }).click()
  await page.getByRole('heading', { name: 'Proyectos del aula' }).waitFor()
  assert.equal(mutations, before)
})

test('instalar requiere un clic; cancelar permite ver instrucciones y aceptar oculta el botón', async t => {
  const { page } = await fixture(t)
  const prepare = async outcome => page.evaluate(outcome => {
    const event = new Event('beforeinstallprompt', { cancelable: true })
    window.testPromptCount = 0
    Object.assign(event, {
      prompt: async () => { window.testPromptCount++ },
      userChoice: Promise.resolve({ outcome }),
    })
    window.dispatchEvent(event)
  }, outcome)
  await prepare('dismissed')
  assert.equal(await page.evaluate(() => window.testPromptCount), 0)
  await page.locator('#install-app').click()
  assert.equal(await page.evaluate(() => window.testPromptCount), 1)
  await page.locator('#install-app').click()
  await page.locator('#install-help').waitFor({ state: 'visible' })
  if (process.env.UI_SCREENSHOTS) await page.screenshot({ path: resolve(process.env.UI_SCREENSHOTS, 'dockyard-instalar.png'), fullPage: true })
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.activeElement?.id === 'install-app')
  await prepare('accepted')
  await page.locator('#install-app').click()
  await page.locator('#install-app').waitFor({ state: 'hidden' })
})

test('appinstalled oculta la oferta y documentación comparte el manifiesto', async t => {
  const { page } = await fixture(t)
  await page.goto(base + '/docs/')
  assert.equal(await page.locator('link[rel=manifest]').getAttribute('href'), '/manifest.webmanifest')
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')))
  await page.locator('#install-app').waitFor({ state: 'hidden' })
})


test('al activar elimina solo cachés antiguas de Dockyard', async t => {
  unavailable = false
  const context = await browser.newContext()
  t.after(() => context.close())
  const page = await context.newPage()
  await page.goto(base + '/offline.html')
  await page.evaluate(async () => {
    await caches.open('dockyard-offline-v0')
    await caches.open('otra-cache')
  })
  await page.goto(base)
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
  assert.deepEqual((await page.evaluate(() => caches.keys())).sort(), ['dockyard-offline-v1', 'otra-cache'].sort())
})
