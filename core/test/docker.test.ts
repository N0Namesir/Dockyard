// Pruebas de integración con Docker real, según los criterios de terminado de la ficha del Área 1:
//
//   npm run test:docker -w core
//
// Usan una carpeta temporal como PROJECTS_DIR, publican los puertos 8081 a 8083 y al terminar
// eliminan los contenedores y volúmenes que crearon. La primera vez descargan imágenes.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { after, before, describe, test } from 'node:test'
import { buildZip, createTestZips, entriesFrom } from '../../ejemplos/crear-zips.ts'
import { getProjectStatus, normalizeProjectName, prepareProject, startProject, stopProject } from '../src/index.ts'
import { run } from '../src/run.ts'

const EJEMPLOS = join(import.meta.dirname, '..', '..', 'ejemplos')
const used = new Set<string>()
let base: string
let zips: Awaited<ReturnType<typeof createTestZips>>

/** Nombre único por prueba, para no chocar con proyectos reales del equipo. */
function uniqueName(label: string): string {
  const name = normalizeProjectName(`dockyard-test-${label}`)
  used.add(name)
  return name
}

async function projectFolders(): Promise<string[]> {
  return readdir(process.env.PROJECTS_DIR!)
}

async function fetchText(port: number): Promise<string> {
  for (let i = 0; i < 20; i++) {
    try {
      return await (await fetch(`http://localhost:${port}`)).text()
    } catch {
      await sleep(500)
    }
  }
  throw new Error(`Nada responde en el puerto ${port}`)
}

before(async () => {
  base = await mkdtemp(join(tmpdir(), 'dockyard-docker-'))
  process.env.PROJECTS_DIR = join(base, 'projects')
  await mkdir(process.env.PROJECTS_DIR)
  zips = await createTestZips(join(base, 'zips'))
})

after(async () => {
  for (const name of used) {
    await run('docker', ['compose', '-p', name, 'down', '-v', '--remove-orphans'], { timeoutMs: 120_000 }).catch(() => {})
  }
  await rm(base, { recursive: true, force: true })
})

describe('prepareProject', () => {
  test('ZIP con el compose en la raíz', async () => {
    const name = uniqueName('zip-raiz')
    const project = await prepareProject({ type: 'zip', filePath: zips.raiz }, name)
    assert.equal(project.name, name)
    assert.equal(project.dir, join(process.env.PROJECTS_DIR!, name))
    assert.ok(existsSync(join(project.dir, 'compose.yaml')))
    assert.ok(existsSync(zips.raiz), 'el núcleo no borra el ZIP')
  })

  test('ZIP con una carpeta intermedia', async () => {
    const name = uniqueName('zip-intermedia')
    const project = await prepareProject({ type: 'zip', filePath: zips.intermedia }, name)
    assert.equal(project.dir, join(process.env.PROJECTS_DIR!, name, 'prueba-estatico'))
  })

  test('normaliza el nombre', async () => {
    used.add('dockyard-test-alvarez-co')
    const project = await prepareProject({ type: 'zip', filePath: zips.raiz }, 'Dockyard Test Álvarez & Co.')
    assert.equal(project.name, 'dockyard-test-alvarez-co')
  })

  test('copia .env.example como .env', async () => {
    const zip = join(base, 'zips', 'prueba-bd.zip')
    await writeFile(zip, buildZip(await entriesFrom(join(EJEMPLOS, 'prueba-bd'))))
    const project = await prepareProject({ type: 'zip', filePath: zip }, uniqueName('env'))
    assert.equal(await readFile(join(project.dir, '.env'), 'utf8'), 'POSTGRES_PASSWORD=ejemplo\n')
  })

  const failures: [string, () => Parameters<typeof prepareProject>[0], RegExp][] = [
    ['ZIP sin compose', () => ({ type: 'zip', filePath: zips.sinCompose }), /No se encontró un archivo compose/],
    ['ZIP dañado', () => ({ type: 'zip', filePath: zips.danado }), /ZIP válido/],
    ['ZIP inexistente', () => ({ type: 'zip', filePath: join(base, 'no-existe.zip') }), /No se encontró el archivo ZIP/],
    ['URL que no es https', () => ({ type: 'git', url: 'http://github.com/x/y' }), /https:\/\//],
    ['URL no válida', () => ({ type: 'git', url: 'no es una url' }), /no es válida/],
    ['repositorio inexistente o privado', () => ({ type: 'git', url: 'https://github.com/N0Namesir/no-existe-dockyard' }), /público/],
    ['repositorio sin compose', () => ({ type: 'git', url: 'https://github.com/octocat/Hello-World' }), /No se encontró un archivo compose/],
  ]
  for (const [label, source, message] of failures) {
    test(`falla sin dejar carpetas a medias: ${label}`, async () => {
      const name = uniqueName(`falla-${label}`)
      await assert.rejects(prepareProject(source(), name), message)
      assert.ok(!(await projectFolders()).includes(name))
    })
  }

  test('falla si ya existe un proyecto con ese nombre, sin borrar el existente', async () => {
    const name = uniqueName('repetido')
    await prepareProject({ type: 'zip', filePath: zips.raiz }, name)
    await assert.rejects(prepareProject({ type: 'zip', filePath: zips.raiz }, name), /Ya existe un proyecto con ese nombre/)
    assert.ok(existsSync(join(process.env.PROJECTS_DIR!, name, 'compose.yaml')))
  })
})

describe('encender, consultar y apagar', () => {
  test('prueba-estatico: running con su puerto, sirve la carpeta montada y se apaga', async () => {
    const name = uniqueName('estatico')
    const { dir } = await prepareProject({ type: 'zip', filePath: zips.raiz }, name)
    assert.deepEqual(await getProjectStatus(name), { state: 'stopped', ports: [] })

    assert.deepEqual(await startProject(dir, name), { state: 'running', ports: [8081] })
    assert.match(await fetchText(8081), /prueba-estatico funciona/)
    assert.deepEqual(await getProjectStatus(name), { state: 'running', ports: [8081] })

    assert.deepEqual(await stopProject(dir, name), { state: 'stopped', ports: [] })
  })

  test('choque de puertos: el mensaje nombra al contenedor que ocupa el puerto', async () => {
    const estatico = uniqueName('choque-a')
    const conflicto = uniqueName('choque-b')
    await startProject(join(EJEMPLOS, 'prueba-estatico'), estatico)
    try {
      await assert.rejects(
        startProject(join(EJEMPLOS, 'prueba-conflicto'), conflicto),
        new RegExp(`El puerto 8081 ya está en uso por el contenedor ${estatico}-web-1`),
      )
      assert.equal((await getProjectStatus(conflicto)).state, 'stopped')
      // Encender de nuevo un proyecto que ya corre no choca consigo mismo.
      assert.equal((await startProject(join(EJEMPLOS, 'prueba-estatico'), estatico)).state, 'running')
    } finally {
      await stopProject(join(EJEMPLOS, 'prueba-estatico'), estatico)
    }
  })

  test('prueba-build: construye su imagen desde cero y responde', { timeout: 600_000 }, async () => {
    const name = uniqueName('build')
    const dir = join(EJEMPLOS, 'prueba-build')
    assert.deepEqual(await startProject(dir, name), { state: 'running', ports: [8083] })
    assert.equal(await fetchText(8083), 'prueba-build funciona\n')
    await stopProject(dir, name)
  })

  test('prueba-bd: conserva los datos después de apagar y encender', { timeout: 600_000 }, async () => {
    const zip = join(base, 'zips', 'prueba-bd-persistencia.zip')
    await writeFile(zip, buildZip(await entriesFrom(join(EJEMPLOS, 'prueba-bd'))))
    const name = uniqueName('bd')
    const { dir } = await prepareProject({ type: 'zip', filePath: zip }, name)
    const prefix = ['compose', '-p', name, '--project-directory', dir, '-f', join(dir, 'compose.yaml')]
    const psql = (sql: string) => run('docker', [...prefix, 'exec', '-T', 'db', 'psql', '-U', 'postgres', '-tAc', sql])

    async function waitForDb() {
      for (let i = 0; i < 60; i++) {
        if (await psql('select 1').then(() => true, () => false)) return
        await sleep(1000)
      }
      throw new Error('postgres no arrancó')
    }

    assert.deepEqual(await startProject(dir, name), { state: 'running', ports: [8082] })
    await waitForDb()
    await psql("create table notas (texto text); insert into notas values ('sigue aquí')")

    assert.equal((await stopProject(dir, name)).state, 'stopped')
    assert.equal((await startProject(dir, name)).state, 'running')
    await waitForDb()
    assert.equal((await psql('select texto from notas')).trim(), 'sigue aquí')
    await stopProject(dir, name)
  })

  test('un proyecto que enciende y se cae devuelve sus últimas líneas de registro', async () => {
    const name = uniqueName('se-cae')
    const dir = join(base, basename(name))
    await mkdir(dir)
    await writeFile(
      join(dir, 'compose.yaml'),
      'services:\n  app:\n    image: busybox\n    command: ["sh", "-c", "echo falta la variable DATABASE_URL; exit 1"]\n',
    )
    await assert.rejects(startProject(dir, name), /se detuvieron enseguida[\s\S]*falta la variable DATABASE_URL/)
  })

  test('un compose con errores da un mensaje claro', async () => {
    // prueba-bd exige POSTGRES_PASSWORD; sin .env el compose no es válido.
    const name = uniqueName('compose-invalido')
    await assert.rejects(startProject(join(EJEMPLOS, 'prueba-bd'), name), /El archivo compose del proyecto tiene errores[\s\S]*POSTGRES_PASSWORD/)
  })

  test('rechaza nombres sin normalizar', async () => {
    await assert.rejects(getProjectStatus('Mi Proyecto'), /no es válido/)
    await assert.rejects(startProject(join(EJEMPLOS, 'prueba-estatico'), '../x'), /no es válido/)
  })
})
