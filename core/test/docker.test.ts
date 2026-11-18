// Pruebas de integración con Docker real, según los criterios de terminado de la ficha del Área 1:
//
//   npm run test:docker -w core
//
// Usan una carpeta temporal como PROJECTS_DIR, publican los puertos 8081 a 8085 y al terminar
// eliminan los contenedores y volúmenes que crearon. La primera vez descargan imágenes.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { after, before, describe, test } from 'node:test'
import { buildZip, createTestZips, entriesFrom } from '../../ejemplos/crear-zips.ts'
import { getDiskUsage, getProjectLogs, getProjectStatus, getProjectStatuses, getResources, normalizeProjectName, PortConflictError, prepareProject, pruneProjectImages, removeProject, renameProject, replaceProjectZip, resetProjectData, startProject, stopProject } from '../src/index.ts'
import { run } from '../src/run.ts'
import type { StartProgress } from '../src/types.ts'

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
    ['URL con credenciales', () => ({ type: 'git', url: 'https://usuario:token@github.com/x/y' }), /usuario ni contraseña/],
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

    const seen: StartProgress[] = []
    assert.deepEqual(await startProject(dir, name, { onProgress: (progress) => seen.push(progress) }), { state: 'running', ports: [8081] })
    assert.equal(seen[0]?.stage, 'Revisando puertos y nombres')
    assert.equal(seen.at(-1)?.stage, 'Comprobando que sigan encendidos')
    assert.ok(seen.some((progress) => progress.stage === 'Arrancando contenedores'), 'Docker no reportó el arranque')
    assert.ok(seen.at(-1)?.lines.some((line) => /Container .* Started/.test(line)), 'faltan las líneas de Docker')
    assert.match(await fetchText(8081), /prueba-estatico funciona/)
    assert.deepEqual(await getProjectStatus(name), { state: 'running', ports: [8081] })
    assert.deepEqual((await getProjectStatuses())[name], { state: 'running', ports: [8081] })

    const usage = await getResources()
    assert.ok(usage.memoryLimit > 0)
    assert.ok(usage.projects[name]!.memoryBytes > 0)
    assert.deepEqual(usage.projects[name]!.services.map((service) => service.service), ['web'])

    assert.deepEqual(await stopProject(dir, name), { state: 'stopped', ports: [] })
    assert.equal((await getResources()).projects[name], undefined)
  })

  test('choque de puertos: el error nombra al contenedor y al proyecto que ocupan el puerto', async () => {
    const estatico = uniqueName('choque-a')
    const conflicto = uniqueName('choque-b')
    await startProject(join(EJEMPLOS, 'prueba-estatico'), estatico)
    try {
      await assert.rejects(startProject(join(EJEMPLOS, 'prueba-conflicto'), conflicto), (error) => {
        assert.ok(error instanceof PortConflictError)
        assert.match(error.message, new RegExp(`El puerto 8081 ya está en uso por el contenedor ${estatico}-web-1`))
        assert.deepEqual([error.port, error.container, error.project], [8081, `${estatico}-web-1`, estatico])
        return true
      })
      assert.equal((await getProjectStatus(conflicto)).state, 'stopped')
      // Encender de nuevo un proyecto que ya corre no choca consigo mismo.
      assert.equal((await startProject(join(EJEMPLOS, 'prueba-estatico'), estatico)).state, 'running')
    } finally {
      await stopProject(join(EJEMPLOS, 'prueba-estatico'), estatico)
    }
  })

  test('un puerto ocupado por un programa que no es Docker da un mensaje en español y no deja nada encendido', async () => {
    const name = uniqueName('puerto-ocupado')
    const dir = join(base, name)
    await mkdir(dir)
    await writeFile(
      join(dir, 'compose.yaml'),
      'services:\n  web:\n    image: busybox\n    command: ["sleep", "600"]\n    ports: ["8084:80"]\n  local:\n    image: busybox\n    command: ["sleep", "600"]\n    ports: ["127.0.0.1:8085:80"]\n',
    )
    const { createServer } = await import('node:net')
    const program = createServer().listen(8084, '0.0.0.0')
    await new Promise((resolve) => program.once('listening', resolve))
    try {
      await assert.rejects(startProject(dir, name), {
        message: 'El puerto 8084 ya lo usa otro programa de esta PC que no es un proyecto de Docker. Ciérralo o cambia el puerto en el compose del proyecto.',
      })
      assert.equal((await getProjectStatus(name)).state, 'stopped')
    } finally {
      await new Promise((resolve) => program.close(resolve))
    }
    // Libre el puerto, enciende; el que se publica solo en 127.0.0.1 queda marcado.
    const status = await startProject(dir, name)
    assert.deepEqual(status, { state: 'running', ports: [8084, 8085], loopbackPorts: [8085] })
    assert.deepEqual((await getProjectStatuses())[name], status)
    await stopProject(dir, name)
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

  test('restart: always que falla queda apagado de verdad, con su registro', async () => {
    const name = uniqueName('reinicia')
    const dir = join(base, basename(name))
    await mkdir(dir)
    await writeFile(
      join(dir, 'compose.yaml'),
      'services:\n  app:\n    image: busybox\n    restart: always\n    command: ["sh", "-c", "echo falta la clave; exit 1"]\n',
    )
    await assert.rejects(startProject(dir, name), /se detuvieron enseguida[\s\S]*falta la clave/)
    assert.equal((await getProjectStatus(name)).state, 'stopped')
  })

  test('container_name repetido: nombra al proyecto que lo tiene, aunque esté apagado', async () => {
    const compose = 'services:\n  db:\n    image: busybox\n    container_name: dockyard-test-nombre-fijo\n    command: ["sleep", "600"]\n'
    const first = uniqueName('nombre-a')
    const second = uniqueName('nombre-b')
    for (const name of [first, second]) {
      await mkdir(join(base, name))
      await writeFile(join(base, name, 'compose.yaml'), compose)
    }
    await startProject(join(base, first), first)
    await stopProject(join(base, first), first)
    await assert.rejects(
      startProject(join(base, second), second),
      new RegExp(`El nombre de contenedor dockyard-test-nombre-fijo ya lo usa el proyecto ${first}`),
    )
    // El dueño del nombre puede encender de nuevo.
    assert.equal((await startProject(join(base, first), first)).state, 'running')
    await stopProject(join(base, first), first)
  })

  test('no registra un nombre que ya usa otro proyecto de Docker', async () => {
    const name = uniqueName('ocupado')
    await startProject(join(EJEMPLOS, 'prueba-estatico'), name)
    try {
      await assert.rejects(prepareProject({ type: 'zip', filePath: zips.raiz }, name), /ya lo usa otro proyecto de Docker/)
      assert.ok(!(await projectFolders()).includes(name))
    } finally {
      await stopProject(join(EJEMPLOS, 'prueba-estatico'), name)
    }
  })

  test('un proyecto a medias aparece encendido, con el servicio caído y su registro', async () => {
    const name = uniqueName('a-medias')
    const dir = join(base, basename(name))
    await mkdir(dir)
    await writeFile(
      join(dir, 'compose.yaml'),
      'services:\n  web:\n    image: busybox\n    command: ["sleep", "600"]\n  api:\n    image: busybox\n    command: ["sh", "-c", "echo falta la clave de la api; exit 1"]\n',
    )
    assert.deepEqual(await startProject(dir, name), { state: 'running', ports: [], failedServices: ['api'] })
    // La consulta de toda la lista llega al mismo resultado que la de un solo proyecto.
    assert.deepEqual((await getProjectStatuses())[name], await getProjectStatus(name))
    assert.match(await getProjectLogs(name), /falta la clave de la api/)
    await stopProject(dir, name)
    assert.match(await getProjectLogs(name), /falta la clave de la api/)
  })

  test('removeProject borra contenedores, volúmenes, imagen y carpeta, y se puede repetir', { timeout: 300_000 }, async () => {
    const name = uniqueName('borrar')
    const dir = join(process.env.PROJECTS_DIR!, name)
    await mkdir(dir)
    await writeFile(join(dir, 'Dockerfile'), 'FROM busybox\n')
    await writeFile(
      join(dir, 'compose.yaml'),
      'services:\n  app:\n    build: .\n    command: ["sleep", "600"]\n    volumes: ["datos:/datos"]\nvolumes:\n  datos:\n',
    )
    assert.equal((await startProject(dir, name)).state, 'running')

    await removeProject(name)
    assert.ok(!existsSync(dir))
    assert.deepEqual(await getProjectStatus(name), { state: 'stopped', ports: [] })
    assert.equal(await run('docker', ['volume', 'ls', '-q', '--filter', `name=${name}_datos`]), '')
    assert.equal(await run('docker', ['images', '-q', `${name}-app`]), '')
    await removeProject(name)
  })

  test('resetProjectData borra contenedores y volúmenes, y conserva la carpeta, la imagen y las carpetas montadas', { timeout: 300_000 }, async () => {
    const name = uniqueName('reiniciar')
    const dir = join(process.env.PROJECTS_DIR!, name)
    await mkdir(join(dir, 'montada'), { recursive: true })
    await writeFile(join(dir, 'montada', 'del-equipo.txt'), 'no se toca\n')
    await writeFile(join(dir, 'Dockerfile'), 'FROM busybox\n')
    await writeFile(
      join(dir, 'compose.yaml'),
      'services:\n  app:\n    build: .\n    command: ["sleep", "600"]\n    volumes: ["datos:/datos", "./montada:/montada"]\nvolumes:\n  datos:\n',
    )
    const prefix = ['compose', '-p', name, '--project-directory', dir, '-f', join(dir, 'compose.yaml')]
    assert.equal((await startProject(dir, name, { build: true })).state, 'running')
    await run('docker', [...prefix, 'exec', '-T', 'app', 'touch', '/datos/marca'])
    await stopProject(dir, name)

    await resetProjectData(dir, name)
    assert.equal(await run('docker', ['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${name}`]), '')
    assert.equal((await run('docker', ['ps', '-aq', '--filter', `label=com.docker.compose.project=${name}`])).trim(), '')
    assert.notEqual((await run('docker', ['images', '-q', `${name}-app`])).trim(), '', 'la imagen se conserva')
    assert.equal(await readFile(join(dir, 'montada', 'del-equipo.txt'), 'utf8'), 'no se toca\n')

    // El siguiente encendido crea el volumen de nuevo, vacío, sin reconstruir.
    assert.equal((await startProject(dir, name)).state, 'running')
    await assert.rejects(run('docker', [...prefix, 'exec', '-T', 'app', 'test', '-f', '/datos/marca']))
    await stopProject(dir, name)
    await assert.rejects(resetProjectData(dir, 'Sin Normalizar'), /no es válido/)
  })

  test('pruneProjectImages borra solo las versiones viejas de los proyectos pedidos', { timeout: 300_000 }, async () => {
    const name = uniqueName('disco')
    const other = uniqueName('disco-otro')
    const dirs: Record<string, string> = {}
    for (const project of [name, other]) {
      const dir = dirs[project] = join(process.env.PROJECTS_DIR!, project)
      await mkdir(dir)
      await writeFile(join(dir, 'compose.yaml'), 'services:\n  app:\n    build: .\n    command: ["sleep", "600"]\n    volumes: ["datos:/datos"]\nvolumes:\n  datos:\n')
      // Dos versiones: la primera queda sin nombre al reconstruir (en el almacén clásico de Docker).
      for (const version of ['uno', 'dos']) {
        await writeFile(join(dir, 'Dockerfile'), `FROM busybox\nRUN echo ${version}-${project} > /version\n`)
        await startProject(dir, project, { build: true })
      }
      await stopProject(dir, project)
    }
    const images = async (project: string) => (await run('docker', ['image', 'ls', '-aq', '--filter', `label=com.docker.compose.project=${project}`])).split('\n').filter(Boolean)
    const otherBefore = await images(other)

    const usage = await getDiskUsage()
    assert.ok(usage.projects[name]!.imageBytes > 0)
    assert.ok(usage.projects[name]!.volumeBytes >= 0)
    assert.ok(name in usage.projects && other in usage.projects)

    const before = (await images(name)).length
    const result = await pruneProjectImages([name])
    const after = await getDiskUsage()
    assert.equal(after.projects[name]!.unusedImageBytes, 0)
    assert.equal((await images(name)).length, 1, 'queda solo la imagen actual')
    assert.equal(result.removed, before - 1)
    assert.deepEqual(await images(other), otherBefore, 'no toca otros proyectos')
    assert.equal(await run('docker', ['volume', 'ls', '-q', '--filter', `name=${name}_datos`]), `${name}_datos\n`, 'no borra volúmenes')
    // La imagen actual se conserva aunque el proyecto ya no tenga contenedores.
    await resetProjectData(dirs[name]!, name)
    await pruneProjectImages([name])
    assert.equal((await images(name)).length, 1)
    await assert.rejects(pruneProjectImages(['Sin Normalizar']), /no es válido/)
  })

  test('removeProject funciona aunque el compose ya no sea válido', async () => {
    const name = uniqueName('borrar-invalido')
    const dir = join(process.env.PROJECTS_DIR!, name)
    await mkdir(dir)
    await writeFile(join(dir, 'compose.yaml'), 'services:\n  app:\n    image: busybox\n    command: ["sleep", "600"]\n')
    assert.equal((await startProject(dir, name)).state, 'running')
    await writeFile(join(dir, 'compose.yaml'), 'esto: [no es valido\n')
    await removeProject(name)
    assert.ok(!existsSync(dir))
    assert.equal((await getProjectStatus(name)).state, 'stopped')
  })

  test('removeProject indica cómo borrar archivos de root', { skip: process.getuid?.() === 0 }, async () => {
    const name = uniqueName('borrar-root')
    const dir = join(process.env.PROJECTS_DIR!, name)
    await mkdir(dir)
    await writeFile(
      join(dir, 'compose.yaml'),
      'services:\n  app:\n    image: busybox\n    command: ["sh", "-c", "mkdir -p /datos/sub; touch /datos/sub/x; sleep 600"]\n    volumes: ["./datos:/datos"]\n',
    )
    await startProject(dir, name)
    await assert.rejects(removeProject(name), /sudo rm -rf/)
    assert.equal((await getProjectStatus(name)).state, 'stopped')
    // Devuelve los archivos al usuario y repite: ahora termina de borrar.
    await run('docker', ['run', '--rm', '-v', `${dir}:/d`, 'busybox', 'chown', '-R', `${process.getuid!()}`, '/d'])
    await removeProject(name)
    assert.ok(!existsSync(dir))
  })

  test('rechaza nombres sin normalizar', async () => {
    await assert.rejects(getProjectStatus('Mi Proyecto'), /no es válido/)
    await assert.rejects(startProject(join(EJEMPLOS, 'prueba-estatico'), '../x'), /no es válido/)
  })
})

describe('replaceProjectZip', () => {
  /** ZIP de prueba-estatico con otra página: así se nota qué versión sirve. */
  async function zipWithPage(file: string, text: string): Promise<string> {
    const entries = (await entriesFrom(join(EJEMPLOS, 'prueba-estatico')))
      .map((entry) => entry.name === 'html/index.html' ? { ...entry, data: Buffer.from(`<h1>${text}</h1>`) } : entry)
    const zip = join(base, 'zips', file)
    await writeFile(zip, buildZip(entries))
    return zip
  }

  test('cambia el código, borra lo que había en la carpeta y el proyecto sirve la versión nueva', async () => {
    const name = uniqueName('reemplazo')
    const { dir } = await prepareProject({ type: 'zip', filePath: zips.raiz }, name)
    assert.equal((await startProject(dir, name)).state, 'running')
    assert.match(await fetchText(8081), /prueba-estatico funciona/)
    await stopProject(dir, name)
    await writeFile(join(dir, 'dato-viejo.txt'), 'x')

    const zip = await zipWithPage('version-2.zip', 'versión 2')
    const result = await replaceProjectZip(name, zip)
    assert.deepEqual(result, { dir, leftover: null })
    assert.ok(!existsSync(join(dir, 'dato-viejo.txt')))
    assert.ok(existsSync(zip), 'el núcleo no borra el ZIP')
    assert.deepEqual(await readdir(join(process.env.PROJECTS_DIR!, '.reemplazos', name)), [])

    try {
      assert.equal((await startProject(dir, name, { build: true })).state, 'running')
      assert.match(await fetchText(8081), /versión 2/)
    } finally {
      await stopProject(dir, name)
    }
  })

  test('si el ZIP nuevo no sirve, el proyecto queda como estaba', async () => {
    const name = uniqueName('reemplazo-falla')
    const { dir } = await prepareProject({ type: 'zip', filePath: zips.raiz }, name)
    const before = await readFile(join(dir, 'html', 'index.html'), 'utf8')

    await assert.rejects(replaceProjectZip(name, zips.sinCompose), /no trae un archivo compose.*se dejó como estaba/)
    await assert.rejects(replaceProjectZip(name, zips.danado), /ZIP válido/)
    await assert.rejects(replaceProjectZip(name, join(base, 'no-existe.zip')), /No se encontró el archivo ZIP/)
    assert.equal(await readFile(join(dir, 'html', 'index.html'), 'utf8'), before)
    assert.deepEqual(await readdir(join(process.env.PROJECTS_DIR!, '.reemplazos', name)), [])
    await assert.rejects(replaceProjectZip(uniqueName('reemplazo-sin-carpeta'), zips.raiz), /No se encontró la carpeta del proyecto/)
    await assert.rejects(replaceProjectZip('../x', zips.raiz), /no es válido/)
  })

  test('si la versión anterior tiene archivos de root, reemplaza igual y dice dónde quedó', { skip: process.getuid?.() === 0 }, async () => {
    const name = uniqueName('reemplazo-root')
    const dir = join(process.env.PROJECTS_DIR!, name)
    await mkdir(dir)
    await writeFile(
      join(dir, 'compose.yaml'),
      'services:\n  app:\n    image: busybox\n    command: ["sh", "-c", "mkdir -p /datos/sub; touch /datos/sub/x; sleep 600"]\n    volumes: ["./datos:/datos"]\n',
    )
    await startProject(dir, name)
    await stopProject(dir, name)

    const { leftover } = await replaceProjectZip(name, zips.raiz)
    const previous = join(process.env.PROJECTS_DIR!, '.reemplazos', name, 'anterior')
    assert.equal(leftover, previous)
    assert.ok(existsSync(join(previous, 'datos', 'sub', 'x')))
    assert.ok(existsSync(join(dir, 'html', 'index.html')))

    // Un segundo reemplazo pide borrar los restos con sudo antes de seguir.
    await assert.rejects(replaceProjectZip(name, zips.raiz), new RegExp(`sudo rm -rf ${previous}`))
    await run('docker', ['run', '--rm', '-v', `${previous}:/d`, 'busybox', 'chown', '-R', `${process.getuid!()}`, '/d'])
    assert.equal((await replaceProjectZip(name, zips.raiz)).leftover, null)
    await removeProject(name)
    assert.ok(!existsSync(join(process.env.PROJECTS_DIR!, '.reemplazos', name)))
  })
})

describe('renameProject', () => {
  test('cambia el nombre de compose y la carpeta; enciende con el nombre nuevo', async () => {
    const name = uniqueName('nombre-viejo')
    const newName = uniqueName('nombre-nuevo')
    const { dir } = await prepareProject({ type: 'zip', filePath: zips.raiz }, name)
    assert.equal((await startProject(dir, name)).state, 'running')
    await assert.rejects(renameProject(name, newName), /Apaga el proyecto antes de cambiarle el nombre/)
    await stopProject(dir, name)

    const renamed = await renameProject(name, newName)
    assert.deepEqual(renamed, { dir: join(process.env.PROJECTS_DIR!, newName), name: newName })
    assert.ok(!existsSync(dir), 'queda la carpeta con el nombre anterior')
    assert.equal((await getProjectStatuses())[name], undefined, 'quedan contenedores con el nombre anterior')

    try {
      // La carpeta montada con ruta relativa sigue funcionando desde la carpeta nueva.
      assert.deepEqual(await startProject(renamed.dir, newName), { state: 'running', ports: [8081] })
      assert.match(await fetchText(8081), /prueba-estatico funciona/)
    } finally {
      await stopProject(renamed.dir, newName)
    }
    await removeProject(newName)
  })

  test('se niega si el proyecto guarda datos en volúmenes o el nombre nuevo ya existe', async () => {
    const name = uniqueName('con-volumen')
    const other = uniqueName('carpeta-ocupada')
    const compose = [
      'services:',
      '  web:',
      '    image: nginx:alpine',
      '    volumes:',
      '      - datos:/datos',
      'volumes:',
      '  datos:',
      '',
    ].join('\n')
    const zip = join(base, 'zips', 'con-volumen.zip')
    await writeFile(zip, buildZip([{ name: 'compose.yaml', data: Buffer.from(compose) }]))
    const { dir } = await prepareProject({ type: 'zip', filePath: zip }, name)
    await prepareProject({ type: 'zip', filePath: zips.raiz }, other)

    await assert.rejects(renameProject(name, other), /Ya existe la carpeta/)
    // Encender crea el volumen: desde ahí el nombre ya no se puede cambiar.
    await startProject(dir, name)
    await stopProject(dir, name)
    await assert.rejects(renameProject(name, uniqueName('sin-datos')), (err: Error) => {
      assert.match(err.message, new RegExp(`volúmenes de Docker \\(${name}_datos\\)`))
      return true
    })
    assert.ok(existsSync(dir), 'la carpeta debe quedar como estaba')
    await removeProject(name)
    await removeProject(other)
  })
})
