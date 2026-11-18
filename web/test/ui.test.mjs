import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { chromium } from 'playwright'

// Solo se sirve el frontend compilado. Todas las rutas API están interceptadas.
let browser, server, base
const root = resolve(import.meta.dirname, '../dist')
const project = (id, running = false) => ({ id, name: id === 1 ? 'epl-aetheris-blueprint' : 'biblioteca-escolar', team: `Equipo ${id}`, state: running ? 'running' : 'stopped', ports: running ? [8401] : [], url: running ? 'http://localhost:8401' : null, urls: running ? ['http://localhost:8401'] : [], failedServices: [], web: running ? {state:'ok'} : null, warnings: [], progress: null, sourceType:'git', pendingBuild:false, notes:'', displayName: id === 1 ? 'Aetheris Blueprint' : 'Biblioteca escolar', year: 2026, description:'', instructions:'', contacts:[], imageUrl:null })
before(async () => {
  server = createServer(async (req, res) => {
    try {
      const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'))
      if (!path.startsWith(root + '/')) { res.writeHead(403).end(); return }
      const data = await readFile(path)
      res.setHeader('Content-Type', ({'.webmanifest':'application/manifest+json','.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.webp':'image/webp'})[extname(path)] ?? 'application/octet-stream')
      res.end(data)
    } catch { res.writeHead(404).end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch({headless:true})
})
after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)) })
async function fixture(t, viewport={width:1440,height:1000}) {
  const page = await browser.newPage({viewport})
  t.after(() => page.close())
  const errors=[]; page.on('pageerror',e=>errors.push(e.message))
  t.after(()=>assert.deepEqual(errors, []))
  const data = { projects:[project(1,true),project(2)], fail:false, post:null, calls:[] }
  await page.route('**/api/**', async route => {
    const req=route.request(), url=new URL(req.url()), path=url.pathname
    const json=(body,status=200)=>route.fulfill({status,json:body})
    data.calls.push(`${req.method()} ${path}`)
    if(path==='/api/projects' && req.method()==='POST') {
      if(data.post) return data.post(route)
      return json({...project(3),...req.postDataJSON()},201)
    }
    if(path==='/api/projects') {
      if(data.fail) return json({message:'No se pudo conectar.'},500)
      const q=url.searchParams.get('q')?.toLowerCase() ?? ''
      return json(data.projects.filter(p=>(p.name+' '+p.team).toLowerCase().includes(q)))
    }
    if(path==='/api/registrations') return json([])
    if(path==='/api/projects/resources') return json({memoryLimit:24481313587,total:{cpuPercent:.5,memoryBytes:112197632},projects:{1:{cpuPercent:.5,memoryBytes:112197632,services:[]}}})
    if(path==='/api/version') return json({current:'1.2.0',latest:null,updateAvailable:false})
    if(path.endsWith('/logs')) return json({logs:'Servidor iniciado'})
    return json({message:'Ruta no prevista en prueba'},404)
  })
  await page.goto(base)
  await page.locator('.project-row').first().waitFor()
  return {page,data}
}

test('panel, borrador, Escape, foco de origen y envío en segundo plano',async t=>{
  const {page,data}=await fixture(t)
  await page.locator('#open-register').click()
  await page.locator('[name=team]').first().fill('Equipo 3')
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('#open-register').evaluate(e=>e===document.activeElement),true)
  await page.locator('#open-register').click()
  assert.equal(await page.locator('#register-form [name=team]').inputValue(),'Equipo 3')
  await page.locator('#register-form [name=name]').fill('tienda')
  await page.locator('#register-form [name=name]').press('Tab')
  assert.equal(await page.locator('#register-form [name=year]').evaluate(e=>e===document.activeElement),true)
  await page.keyboard.press('Tab')
  assert.equal(await page.locator('[name=source][value=git]').evaluate(e=>e===document.activeElement),true)
  const outline=await page.locator('[name=source][value=git] + span').evaluate(e=>getComputedStyle(e).outlineStyle)
  assert.notEqual(outline,'none')
  await page.keyboard.press('ArrowRight')
  await page.locator('#zip-field').waitFor({state:'visible'})
  await page.locator('[name=file]').setInputFiles({name:'prueba.zip',mimeType:'application/zip',buffer:Buffer.from('fixture')})
  let release
  data.post = async route => { await new Promise(r=>release=r); await route.fulfill({status:400,json:{message:'El ZIP no contiene compose.'}}) }
  await page.locator('#register-button').click()
  await page.locator('#register-dialog').waitFor({state:'hidden'})
  assert.match(await page.locator('#registration-status').innerText(),/tienda/)
  release()
  await page.locator('#global-message').filter({hasText:'El ZIP no contiene compose.'}).waitFor()
  await page.locator('#open-register').click()
  assert.equal(await page.locator('#register-form [name=name]').inputValue(),'tienda')
  assert.equal(await page.locator('[name=source][value=zip]').isChecked(),true)
})

test('menú, motivo de bloqueo y foco conservado tras refresco automático', async t=>{
  const {page,data}=await fixture(t)
  await page.clock.install()
  const row=page.locator('.project-row').first()
  const openBefore=await row.locator('[data-action=open]').boundingBox()
  await row.locator('[data-action=menu]').click()
  // El menú flota: Abrir no se mueve, así un doble clic en ⋯ no termina abriendo el proyecto.
  assert.deepEqual(await row.locator('[data-action=open]').boundingBox(),openBefore)
  const update=row.locator('[data-action=update]')
  const hint=row.locator('#update-hint-1')
  assert.equal(await update.getAttribute('aria-disabled'),'true')
  assert.equal(await hint.isVisible(),false,'el motivo no se muestra hasta que se busca')
  await update.hover()
  assert.match(await hint.innerText(),/Apaga el proyecto/)
  await row.locator('[data-action=logs]').hover()
  assert.equal(await hint.isVisible(),false)
  await update.click({force:true})
  assert.equal(await hint.isVisible(),true,'al intentar usarlo, explica por qué no se puede')
  assert.equal(await row.locator('.project-menu-content').evaluate(e=>e.matches(':popover-open')),true)
  assert.ok(!data.calls.some(c=>c.endsWith('/update')),'no llama a la API')
  await row.locator('[data-action=logs]').focus()
  data.projects[0].notes='Revisado'
  // visibilitychange usa el mismo refresco que el temporizador, sin esperar 15 segundos.
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')))
  await row.getByText('Revisado',{exact:true}).waitFor()
  assert.equal(await row.locator('[data-action=logs]').evaluate(e=>e===document.activeElement),true)
  assert.equal(await row.locator('.project-menu-content').evaluate(e=>e.matches(':popover-open')),true)
  await page.keyboard.press('Escape')
  assert.equal(await row.locator('[data-action=menu]').evaluate(e=>e===document.activeElement),true)
  await row.locator('[data-action=menu]').click()
  await row.locator('[data-action=remove]').click()
  await page.locator('#remove-dialog').waitFor({state:'visible'})
  await page.locator('#remove-dialog-cancel').click()
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-action') === 'menu', null, {timeout:2000})
  assert.equal(await row.locator('[data-action=menu]').evaluate(e=>e===document.activeElement),true)
})

test('reiniciar datos: bloqueado si está encendido y pide escribir el nombre',async t=>{
  const {page,data}=await fixture(t)
  const reset=[]
  await page.route('**/api/projects/*/reset-data', route => { reset.push(route.request().url()); return route.fulfill({status:200,json:data.projects[1]}) })
  const running=page.locator('.project-row').first()
  await running.locator('[data-action=menu]').click()
  const blocked=running.locator('[data-action=reset]')
  assert.equal(await blocked.getAttribute('aria-disabled'),'true')
  await blocked.click({force:true})
  assert.match(await running.locator('#reset-hint-1').innerText(),/Apaga el proyecto/)
  await page.keyboard.press('Escape')

  const row=page.locator('.project-row').last()
  await row.locator('[data-action=menu]').click()
  // Separado de las acciones normales, junto a Eliminar.
  assert.equal(await row.locator('.menu-danger [data-action=reset] + [data-action=remove]').count(),1)
  await row.locator('[data-action=reset]').click()
  await page.locator('#remove-dialog').waitFor({state:'visible'})
  assert.match(await page.locator('#remove-dialog-text').innerText(),/volúmenes de Docker.*código y su ficha/s)
  assert.equal(await page.locator('#remove-dialog-confirm').isDisabled(),true)
  await page.locator('#remove-dialog-input').fill('biblioteca-escolar')
  await page.locator('#remove-dialog-confirm').click()
  await page.locator('#global-message').filter({hasText:'Se reiniciaron los datos de biblioteca-escolar'}).waitFor()
  assert.equal(reset.length,1)
  assert.match(reset[0],/\/api\/projects\/2\/reset-data$/)
})

test('el menú de acciones se abre hacia arriba si no cabe debajo',async t=>{
  const {page}=await fixture(t,{width:1280,height:420})
  const row=page.locator('.project-row').last()
  await row.scrollIntoViewIfNeeded()
  await page.evaluate(()=>{const b=document.querySelectorAll('[data-action=menu]');const r=b[b.length-1].getBoundingClientRect();scrollBy(0,r.bottom-innerHeight+20)})
  await row.locator('[data-action=menu]').click()
  const button=await row.locator('[data-action=menu]').boundingBox()
  const menu=await row.locator('.project-menu-content').boundingBox()
  assert.ok(menu.y+menu.height<=button.y+1,`menú ${JSON.stringify(menu)} sobre el botón ${JSON.stringify(button)}`)
  assert.ok(menu.y>=0)
  await page.keyboard.press('Escape')
  assert.equal(await row.locator('.project-menu-content').isVisible(),false)
})

test('búsqueda, vacío, fallo y recuperación de la lista',async t=>{
  const {page,data}=await fixture(t)
  await page.locator('#search').fill('no-existe')
  await page.getByText('No se encontraron proyectos con esa búsqueda.').waitFor()
  await page.locator('#search').fill('Equipo 2')
  await page.locator('#project-count').filter({hasText:'1 proyecto'}).waitFor()
  assert.equal(await page.locator('.project-row').count(),1)
  data.fail=true
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')))
  await page.getByText('No se pudo cargar la lista de proyectos.').waitFor()
  data.fail=false
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')))
  await page.locator('.project-row').waitFor()
})

test('móvil sin desplazamiento horizontal y acciones cómodas',async t=>{
  const {page}=await fixture(t,{width:375,height:812})
  for(const width of [320,375,768,1024,1440]) {
    await page.setViewportSize({width,height:900})
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`Ancho ${width}: ${JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll("body *")].filter(e=>e.getBoundingClientRect().right>innerWidth).map(e=>({tag:e.tagName,cls:e.className,right:e.getBoundingClientRect().right}))))}`)
  }
  await page.setViewportSize({width:375,height:812})
  const row=page.locator('.project-row').first()
  for(const action of ['toggle','open','menu']) assert.ok((await row.locator(`[data-action=${action}]`).boundingBox()).height>=44)
  await row.locator('[data-action=menu]').click()
  await row.locator('[data-action=remove]').click()
  await page.locator('#remove-dialog').waitFor({state:'visible'})
  assert.equal(await page.locator('#remove-dialog-confirm').isDisabled(),true)
  await page.locator('#remove-dialog-input').fill('epl-aetheris-blueprint')
  assert.equal(await page.locator('#remove-dialog-confirm').isEnabled(),true)
  await page.locator('#remove-dialog-cancel').click()
})

test('capturas de revisión',async t=>{
  if(!process.env.UI_SCREENSHOTS) return t.skip('Sin directorio de capturas')
  const {page}=await fixture(t)
  await page.screenshot({path:resolve(process.env.UI_SCREENSHOTS,'dockyard-escritorio.png'),fullPage:true})
  await page.locator('#open-register').click()
  await page.screenshot({path:resolve(process.env.UI_SCREENSHOTS,'dockyard-registro.png'),fullPage:true})
  await page.keyboard.press('Escape')
  await page.setViewportSize({width:375,height:812})
  await page.screenshot({path:resolve(process.env.UI_SCREENSHOTS,'dockyard-movil.png'),fullPage:true})
})

test('un diálogo devuelve el foco aunque su fila cambie mientras está abierto',async t=>{
  const {page,data}=await fixture(t)
  const row=page.locator('.project-row').first()
  await row.locator('[data-action=menu]').click()
  await row.locator('[data-action=remove]').click()
  data.projects[0].notes='Cambio desde otra pestaña'
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')))
  await row.getByText('Cambio desde otra pestaña',{exact:true}).waitFor()
  await page.locator('#remove-dialog-cancel').click()
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-action') === 'menu', null, {timeout:2000})
  assert.equal(await row.locator('[data-action=menu]').evaluate(e=>e===document.activeElement),true)
})

test('registro continuo conserva el panel y devuelve el foco al equipo',async t=>{
  const {page,data}=await fixture(t)
  await page.locator('#open-register').click()
  await page.locator('#register-form [name=team]').fill('Equipo 3')
  await page.locator('#register-form [name=name]').fill('tienda')
  await page.locator('[name=repoUrl]').fill('https://github.com/equipo/tienda')
  await page.locator('#register-another').check()
  data.post=async route=>{
    const created={...project(3),name:'tienda',team:'Equipo 3'}
    data.projects.push(created)
    await route.fulfill({status:201,json:created})
  }
  await page.locator('#register-button').click()
  await page.locator('#global-message').filter({hasText:'tienda se registró correctamente.'}).waitFor()
  assert.equal(await page.locator('#register-dialog').isVisible(),true)
  assert.equal(await page.locator('#register-form [name=team]').evaluate(e=>e===document.activeElement),true)
  assert.equal(await page.locator('#register-another').isChecked(),true)
  assert.equal(await page.locator('.project-row').count(),3)
})

test('el nombre para mostrar enlaza a la ficha y Editar ficha abre su edición',async t=>{
  const {page}=await fixture(t)
  const row=page.locator('.project-row').first()
  const link=row.locator('[data-action=details]')
  assert.equal(await link.innerText(),'Aetheris Blueprint')
  assert.equal(await link.getAttribute('href'),'/proyecto/?id=1')
  assert.ok(await row.getByText('epl-aetheris-blueprint',{exact:true}).isVisible(),'el nombre técnico se ve pequeño')
  // Sin imagen, la inicial del nombre para mostrar.
  assert.equal(await row.locator('span[aria-hidden=true]').first().innerText(),'A')
  await row.locator('[data-action=menu]').click()
  assert.equal(await row.locator('[data-action=edit]').getAttribute('href'),'/proyecto/?id=1#editar')
})

test('registrar: envía el año y, si el nombre existe, ofrece el sugerido con un clic',async t=>{
  const {page,data}=await fixture(t)
  const bodies=[]
  data.post=async route=>{
    const body=route.request().postDataJSON()
    bodies.push(body)
    if(bodies.length===1) return route.fulfill({status:409,json:{message:'Ya existe un proyecto con el nombre “tienda”. Usa otro nombre, por ejemplo “tienda-2026”.',suggestion:'tienda-2026'}})
    return route.fulfill({status:201,json:{...project(3),...body}})
  }
  await page.locator('#open-register').click()
  assert.equal(await page.locator('#register-form [name=year]').inputValue(),String(new Date().getFullYear()))
  await page.locator('#register-form [name=team]').fill('Equipo 3')
  await page.locator('#register-form [name=name]').fill('Tienda')
  await page.locator('#register-form [name=year]').fill('2026')
  await page.locator('[name=repoUrl]').fill('https://github.com/equipo/tienda')
  await page.locator('#register-button').click()
  await page.locator('#global-message').filter({hasText:'tienda-2026'}).waitFor()
  await page.locator('#open-register').click()
  const suggestion=page.locator('#use-suggestion')
  assert.equal(await suggestion.innerText(),'Usar el nombre «tienda-2026»')
  await suggestion.click()
  assert.equal(await page.locator('#register-form [name=name]').inputValue(),'tienda-2026')
  assert.equal(await suggestion.isHidden(),true)
  await page.locator('#register-button').click()
  await page.locator('#global-message').filter({hasText:'se registró'}).waitFor()
  assert.deepEqual(bodies[0],{team:'Equipo 3',name:'Tienda',repoUrl:'https://github.com/equipo/tienda',year:2026})
  assert.deepEqual(bodies[1],{team:'Equipo 3',name:'tienda-2026',repoUrl:'https://github.com/equipo/tienda',displayName:'Tienda',year:2026})
})
