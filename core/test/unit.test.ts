// Pruebas que no necesitan Docker: npm test -w core

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { parsePs, portsInUse, requestedContainerNames, requestedPorts, statusFromContainers } from '../src/docker.ts'
import { assertNormalizedName, normalizeProjectName } from '../src/name.ts'
import { findComposeFile } from '../src/paths.ts'

describe('normalizeProjectName', () => {
  const cases: [string, string][] = [
    ['Tienda Equipo 3', 'tienda-equipo-3'],
    ['Álvarez & Co.', 'alvarez-co'],
    ['Mi_App 2', 'mi_app-2'],
    ['---', 'proyecto'],
    ['', 'proyecto'],
    ['_oculto', 'oculto'],
    ['Ñandú  Pingüino', 'nandu-pinguino'],
  ]
  for (const [input, expected] of cases) {
    test(`"${input}" → "${expected}"`, () => assert.equal(normalizeProjectName(input), expected))
  }

  test('assertNormalizedName rechaza nombres sin normalizar', () => {
    assert.doesNotThrow(() => assertNormalizedName('tienda-equipo-3'))
    assert.throws(() => assertNormalizedName('Tienda'))
    assert.throws(() => assertNormalizedName('../etc'))
  })
})

describe('parsePs y statusFromContainers', () => {
  const lines = [
    { State: 'running', Publishers: [{ PublishedPort: 8082 }, { PublishedPort: 8082 }, { PublishedPort: 0 }] },
    { State: 'running', Publishers: [{ PublishedPort: 5432 }] },
    { State: 'exited', Publishers: [{ PublishedPort: 9999 }] },
  ]

  test('acepta un objeto por línea', () => {
    assert.equal(parsePs(lines.map((l) => JSON.stringify(l)).join('\n')).length, 3)
  })
  test('acepta un arreglo (versiones antiguas)', () => {
    assert.equal(parsePs(JSON.stringify(lines)).length, 3)
  })
  test('salida vacía', () => {
    assert.deepEqual(parsePs('  \n'), [])
    assert.deepEqual(statusFromContainers([]), { state: 'stopped', ports: [] })
  })
  test('puertos de contenedores en ejecución, sin repetidos y ordenados', () => {
    assert.deepEqual(statusFromContainers(lines), { state: 'running', ports: [5432, 8082] })
  })
})

describe('estado con contenedores que se reinician', () => {
  test('cuenta como encendido para que se pueda apagar', () => {
    assert.deepEqual(
      statusFromContainers([{ State: 'restarting', Service: 'app', Publishers: [] }]),
      { state: 'running', ports: [], failedServices: ['app'] },
    )
  })
})

describe('servicios caídos', () => {
  const web = { State: 'running', Service: 'web', Publishers: [] }

  test('nombra los que fallaron y los que se reinician', () => {
    assert.deepEqual(
      statusFromContainers([
        web,
        { State: 'exited', ExitCode: 1, Service: 'api' },
        { State: 'restarting', ExitCode: 1, Service: 'cola' },
      ]).failedServices,
      ['api', 'cola'],
    )
  })

  test('salir con 0 no es una falla', () => {
    assert.equal(statusFromContainers([web, { State: 'exited', ExitCode: 0, Service: 'migracion' }]).failedServices, undefined)
  })

  test('un proyecto apagado no tiene servicios caídos', () => {
    assert.deepEqual(statusFromContainers([{ State: 'exited', ExitCode: 137, Service: 'web' }]), { state: 'stopped', ports: [] })
  })
})

describe('requestedContainerNames', () => {
  test('toma solo los nombres fijos', () => {
    assert.deepEqual(
      requestedContainerNames({ services: { a: { container_name: 'base' }, b: {} } }),
      ['base'],
    )
    assert.deepEqual(requestedContainerNames({}), [])
  })
})

describe('requestedPorts', () => {
  test('toma solo puertos fijos', () => {
    const config = {
      services: {
        web: { ports: [{ target: 80, published: '8081', protocol: 'tcp' }, { target: 80, protocol: 'tcp' }] },
        dns: { ports: [{ target: 53, published: '5353', protocol: 'udp' }] },
        rango: { ports: [{ target: 8000, published: '8000-8010' }] },
        db: {},
      },
    }
    assert.deepEqual(requestedPorts(config), [
      { port: 8081, protocol: 'tcp', service: 'web' },
      { port: 5353, protocol: 'udp', service: 'dns' },
    ])
  })
})

describe('portsInUse', () => {
  test('lee Ports, Names y el proyecto de compose', () => {
    const containers = [
      {
        Names: 'prueba-estatico-web-1',
        Labels: 'com.docker.compose.service=web,com.docker.compose.project=prueba-estatico,maintainer=x',
        Ports: '0.0.0.0:8081->80/tcp, [::]:8081->80/tcp, 443/tcp',
      },
      { Names: 'suelto', Labels: '', Ports: '127.0.0.1:8000-8002->8000-8002/tcp' },
      { Names: 'sin-puertos', Labels: '', Ports: '' },
    ]
    const used = portsInUse(containers)
    assert.deepEqual(
      used.map((u) => `${u.port}/${u.protocol} ${u.container} ${u.project}`),
      [
        '8081/tcp prueba-estatico-web-1 prueba-estatico',
        '8081/tcp prueba-estatico-web-1 prueba-estatico',
        '8000/tcp suelto null',
        '8001/tcp suelto null',
        '8002/tcp suelto null',
      ],
    )
  })
})

describe('findComposeFile', async () => {
  const base = await mkdtemp(join(tmpdir(), 'dockyard-test-'))
  after(() => rm(base, { recursive: true, force: true }))

  test('en la raíz, respetando el orden de preferencia', async () => {
    const dir = join(base, 'raiz')
    await mkdir(dir)
    await writeFile(join(dir, 'docker-compose.yml'), '')
    await writeFile(join(dir, 'compose.yaml'), '')
    assert.deepEqual(await findComposeFile(dir), { dir, file: join(dir, 'compose.yaml') })
  })

  test('en una única carpeta intermedia, ignorando ocultas y __MACOSX', async () => {
    const dir = join(base, 'intermedia')
    await mkdir(join(dir, 'proyecto'), { recursive: true })
    await mkdir(join(dir, '__MACOSX'))
    await mkdir(join(dir, '.git'))
    await writeFile(join(dir, 'proyecto', 'docker-compose.yaml'), '')
    const sub = join(dir, 'proyecto')
    assert.deepEqual(await findComposeFile(dir), { dir: sub, file: join(sub, 'docker-compose.yaml') })
  })

  test('null si hay varias carpetas o ningún compose', async () => {
    const dir = join(base, 'varias')
    await mkdir(join(dir, 'a'), { recursive: true })
    await mkdir(join(dir, 'b'))
    await writeFile(join(dir, 'a', 'compose.yaml'), '')
    assert.equal(await findComposeFile(dir), null)
  })
})
