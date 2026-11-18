import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { chromium } from 'playwright'

// Ficha de un proyecto (/proyecto/?id=). Solo se sirve el frontend compilado; la API está interceptada.
let browser, server, base
const root = resolve(import.meta.dirname, '../dist')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' }
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64')

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

const PROJECT = {
  id: 7, name: 'tienda-2026', team: 'Equipo 3', state: 'stopped', ports: [], url: null, urls: [], failedServices: [], web: null,
  warnings: ['Servicio web: monta /etc de la PC.'], progress: null, sourceType: 'git', pendingBuild: false, notes: 'Falta el login.',
  displayName: 'Tienda escolar', year: 2026, description: 'Vende útiles a la comunidad.', instructions: 'Usuario: admin / admin123',
  contacts: [{ name: 'Ana Pérez', email: 'ana@escuela.edu', phone: '+503 7000 0000' }], imageUrl: null,
}

async function fixture(t, { project = PROJECT, hash = '' } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
  t.after(() => page.close())
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  t.after(() => assert.deepEqual(errors, []))
  const data = { project: structuredClone(project), calls: [], patches: [], images: [] }
  await page.route('**/api/**', async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname
    data.calls.push(`${req.method()} ${path}`)
    const json = (body, status = 200) => route.fulfill({ status, json: body })
    if (path === `/api/projects/${project.id}` && req.method() === 'GET') return data.project ? json(data.project) : json({ message: 'El proyecto solicitado no existe.' }, 404)
    if (path === `/api/projects/${project.id}` && req.method() === 'PATCH') {
      const body = req.postDataJSON()
      data.patches.push(body)
      if (data.patchError) return json({ message: data.patchError }, 409)
      Object.assign(data.project, body, body.name ? { name: body.name.toLowerCase() } : {})
      return json(data.project)
    }
    if (path === `/api/projects/${project.id}/image`) {
      data.images.push(req.method())
      data.project.imageUrl = req.method() === 'PUT' ? `/api/projects/${project.id}/image?v=${data.images.length}` : null
      return json(data.project)
    }
    if (path === `/api/projects/${project.id}/start`) { data.project = { ...data.project, state: 'running', ports: [8081], url: 'http://localhost:8081' }; return json(data.project) }
    if (path === '/api/projects/resources') return json({ memoryLimit: 0, total: { cpuPercent: 0, memoryBytes: 0 }, projects: { [project.id]: { cpuPercent: 2, memoryBytes: 150 * 1024 ** 2, services: [] } } })
    return json({ message: 'Ruta no prevista en prueba' }, 404)
  })
  await page.route('**/image?v=*', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }))
  await page.goto(`${base}/proyecto/?id=${project.id}${hash}`)
  return { page, data }
}

test('muestra la ficha completa: nombres, equipo, año, textos, contactos, notas y avisos', async (t) => {
  const { page } = await fixture(t)
  await page.locator('#project-view').waitFor()
  assert.equal(await page.title(), 'Dockyard · Tienda escolar')
  assert.equal(await page.locator('#project-display-name').innerText(), 'Tienda escolar')
  assert.equal(await page.locator('#project-name').innerText(), 'tienda-2026')
  assert.equal(await page.locator('#project-team').innerText(), 'Equipo 3')
  assert.equal(await page.locator('#project-year').innerText(), '2026')
  assert.equal(await page.locator('#project-description').innerText(), 'Vende útiles a la comunidad.')
  assert.equal(await page.locator('#project-instructions').innerText(), 'Usuario: admin / admin123')
  assert.equal(await page.locator('#project-notes').innerText(), 'Falta el login.')
  assert.equal(await page.locator('#project-contacts a[href="mailto:ana@escuela.edu"]').count(), 1)
  assert.equal(await page.locator('#project-contacts a[href="tel:+50370000000"]').count(), 1)
  assert.match(await page.locator('#project-warnings').innerText(), /monta \/etc/)
  // Sin imagen, la inicial sobre un color de la marca.
  assert.equal(await page.locator('#project-image span').innerText(), 'T')
  assert.equal(await page.locator('header a[aria-current=page]').innerText(), 'Proyectos')
})

test('encender desde la ficha muestra Abrir y el consumo', async (t) => {
  const { page, data } = await fixture(t)
  await page.locator('#project-toggle').filter({ hasText: 'Encender' }).click()
  await page.locator('#project-open').waitFor()
  assert.equal(await page.locator('#project-open').getAttribute('href'), 'http://localhost:8081')
  assert.equal(await page.locator('#project-state').innerText(), 'Encendido')
  await page.locator('#project-resources').filter({ hasText: 'memoria 150 MB' }).waitFor()
  assert.ok(data.calls.includes('POST /api/projects/7/start'))
})

test('editar envía solo lo que cambió, agrega un contacto y sube la imagen', async (t) => {
  const { page, data } = await fixture(t, { hash: '#editar' })
  await page.locator('#edit-section').waitFor()
  assert.equal(await page.locator('#edit-form [name=displayName]').evaluate((e) => e === document.activeElement), true)
  assert.equal(await page.locator('#edit-form [name=name]').isDisabled(), false)
  await page.locator('#edit-form [name=description]').fill('Vende útiles y uniformes.')
  await page.locator('#edit-form [name=year]').fill('2025')
  await page.locator('#add-contact').click()
  const second = page.locator('.contact-row').nth(1)
  await second.locator('[data-contact=name]').fill('Luis Gómez')
  await second.locator('[data-contact=email]').fill('luis@escuela.edu')
  await page.locator('#edit-form [name=image]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG })
  assert.equal(await page.locator('#edit-image-preview img').count(), 1, 'muestra la imagen elegida antes de guardar')
  await page.locator('#edit-save').click()
  await page.locator('#project-message').filter({ hasText: 'Se guardaron los cambios de la ficha.' }).waitFor()
  assert.deepEqual(data.patches, [{
    year: 2025,
    description: 'Vende útiles y uniformes.',
    contacts: [PROJECT.contacts[0], { name: 'Luis Gómez', email: 'luis@escuela.edu' }],
  }])
  assert.deepEqual(data.images, ['PUT'])
  assert.equal(await page.locator('#project-image img').getAttribute('src'), '/api/projects/7/image?v=1')
  assert.equal(await page.locator('#project-edit').evaluate((e) => e === document.activeElement), true)
  assert.equal(new URL(page.url()).hash, '')
})

test('editar: un contacto sin nombre, un nombre vacío o un error de la API se muestran sin cerrar', async (t) => {
  const { page, data } = await fixture(t)
  await page.locator('#project-edit').click()
  await page.locator('#add-contact').click()
  await page.locator('.contact-row').nth(1).locator('[data-contact=email]').fill('sin@nombre.edu')
  await page.locator('#edit-save').click()
  assert.equal(await page.locator('#edit-error').innerText(), 'Cada contacto necesita un nombre.')
  await page.locator('.contact-row').nth(1).locator('[data-contact=remove]').click()
  await page.locator('#edit-form [name=displayName]').fill('  ')
  await page.locator('#edit-save').click()
  assert.equal(await page.locator('#edit-error').innerText(), 'El nombre para mostrar no puede quedar vacío.')
  assert.deepEqual(data.patches, [])

  await page.locator('#edit-form [name=displayName]').fill('Tienda')
  await page.locator('#edit-form [name=name]').fill('tienda')
  data.patchError = 'Ya existe un proyecto con el nombre “tienda”. Usa otro nombre, por ejemplo “tienda-2026”.'
  await page.locator('#edit-save').click()
  await page.locator('#edit-error').filter({ hasText: 'Ya existe' }).waitFor()
  assert.equal(await page.locator('#edit-section').isVisible(), true)
  await page.locator('#edit-cancel').click()
  assert.equal(await page.locator('#project-display-name').innerText(), 'Tienda escolar', 'cancelar no cambia la ficha')
})

test('quitar la imagen la borra al guardar; con el proyecto encendido no se cambia el nombre técnico', async (t) => {
  const { page, data } = await fixture(t, { project: { ...PROJECT, state: 'running', imageUrl: '/api/projects/7/image?v=3' } })
  await page.locator('#project-image img').waitFor()
  await page.locator('#project-edit').click()
  assert.equal(await page.locator('#edit-form [name=name]').isDisabled(), true)
  assert.match(await page.locator('#edit-name-hint').innerText(), /Apaga el proyecto/)
  await page.locator('#remove-image').click()
  assert.equal(await page.locator('#edit-image-preview span').innerText(), 'T')
  await page.locator('#edit-save').click()
  await page.locator('#project-message').waitFor()
  assert.deepEqual(data.images, ['DELETE'])
  assert.deepEqual(data.patches, [])
})

test('un proyecto que no existe lo dice', async (t) => {
  const { page, data } = await fixture(t)
  data.project = null
  await page.goto(`${base}/proyecto/?id=7`)
  await page.locator('#project-error').filter({ hasText: 'Ese proyecto no existe' }).waitFor()
  assert.equal(await page.locator('#project-view').isHidden(), true)
})
