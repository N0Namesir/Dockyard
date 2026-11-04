// Pruebas que no necesitan Docker: npm test -w core

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { parsePs, portsInUse, requestedContainerNames, requestedPorts, statusFromContainers } from '../src/docker.ts'
import { assertNormalizedName, normalizeProjectName } from '../src/name.ts'
import { findComposeFile } from '../src/paths.ts'
import { cleanLine, createProgressTracker, stageOf } from '../src/progress.ts'
import { composeWarnings, fileWarnings, secretsIn, sensitiveFileName, suspiciousEnvVars } from '../src/review.ts'
import { run } from '../src/run.ts'
import { zipProblem } from '../src/sources.ts'
import type { StartProgress } from '../src/types.ts'

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

describe('revisión del compose', () => {
  const root = '/projects/p'
  const warningsOf = (service: any) => composeWarnings({ services: { web: service } }, root)

  test('un compose normal no da avisos', () => {
    assert.deepEqual(composeWarnings({
      services: {
        web: {
          build: { context: '/projects/p/app' },
          ports: [{ published: '8101', target: 80 }],
          volumes: [
            { type: 'bind', source: '/projects/p/html', target: '/html' },
            { type: 'volume', source: 'datos', target: '/datos' },
          ],
          network_mode: 'service:db',
          cap_add: ['NET_BIND_SERVICE'],
        },
      },
      volumes: { datos: {} },
    }, root), [])
  })

  const dangerous: [string, any, RegExp][] = [
    ['privileged', { privileged: true }, /privileged/],
    ['network_mode host', { network_mode: 'host' }, /network_mode: host/],
    ['pid host', { pid: 'host' }, /pid: host/],
    ['contenedor ajeno', { network_mode: 'container:otro' }, /contenedor ajeno/],
    ['capacidades', { cap_add: ['SYS_ADMIN'] }, /SYS_ADMIN/],
    ['security_opt', { security_opt: ['seccomp:unconfined'] }, /security_opt/],
    ['dispositivos', { devices: [{ source: '/dev/sda', target: '/dev/sda' }] }, /dispositivos/],
    ['docker.sock', { volumes: [{ type: 'bind', source: '/var/run/docker.sock', target: '/s' }] }, /docker\.sock/],
    ['ruta del sistema', { volumes: [{ type: 'bind', source: '/etc', target: '/e' }] }, /monta \/etc/],
    ['ruta vecina con el mismo prefijo', { volumes: [{ type: 'bind', source: '/projects/p2', target: '/e' }] }, /monta \/projects\/p2/],
    ['subir de carpeta', { volumes: [{ type: 'bind', source: '/projects/p/../otro', target: '/e' }] }, /monta/],
    ['contexto de fuera', { build: { context: '/home/docente' } }, /se construye con/],
  ]
  for (const [label, service, expected] of dangerous) {
    test(`avisa de ${label}`, () => {
      const warnings = warningsOf(service)
      assert.equal(warnings.length, 1)
      assert.match(warnings[0]!, expected)
      assert.match(warnings[0]!, /^Servicio web:/)
    })
  }

  test('un contexto de git no se toma como ruta', () => {
    assert.deepEqual(warningsOf({ build: { context: 'https://github.com/e/p.git' } }), [])
  })

  test('avisa de volúmenes con ruta y de secretos de fuera', () => {
    const warnings = composeWarnings({
      volumes: { malo: { driver_opts: { type: 'none', o: 'bind', device: '/etc' } }, ram: { driver_opts: { device: 'tmpfs' } } },
      secrets: { s: { file: '/home/docente/clave' } },
    }, root)
    assert.equal(warnings.length, 2)
    assert.match(warnings[0]!, /Volumen malo/)
    assert.match(warnings[1]!, /Secreto s/)
  })

  test('un archivo compose vacío no da avisos', () => {
    assert.deepEqual(composeWarnings({}, root), [])
    assert.deepEqual(composeWarnings(null, root), [])
  })
})

describe('revisión de archivos', () => {
  const googleKey = 'AIza' + 'B'.repeat(35)
  const groqKey = 'gsk_' + 'a1'.repeat(15)

  test('reconoce claves por su forma', () => {
    assert.deepEqual(secretsIn(`const k = "${googleKey}"`), ['una clave de Google'])
    assert.deepEqual(secretsIn(`${groqKey}`), ['una clave de Groq'])
    assert.deepEqual(secretsIn('-----BEGIN RSA ' + 'PRIVATE KEY-----'), ['una clave privada'])
    assert.deepEqual(secretsIn('risk-assessment task-manager sk-corta AIzaCorta'), [])
  })

  test('distingue valores de ejemplo de claves reales en un .env', () => {
    assert.deepEqual(suspiciousEnvVars([
      'JWT_SECRET=9f8e7d6c5b4a39281706f5e4d3c2b1a0',
      'export API_TOKEN="a1b2c3d4e5f6a7b8c9d0e1f2"',
      'GEMINI_API_KEY=',
      'OTRA_KEY=cambia_esta_clave_12345678',
      'MI_KEY=${MI_KEY_REAL:-a1b2c3d4e5f6a7b8c9d0}',
      'SECRET_CORTO=abc123',
      'SOLO_LETRAS_KEY=abcdefghijklmnopqrstuvwxyz',
      'DB_HOST=a1b2c3d4e5f6a7b8c9d0e1f2',
    ].join('\n')), ['JWT_SECRET', 'API_TOKEN'])
  })

  test('reconoce archivos sensibles por el nombre', () => {
    assert.match(sensitiveFileName('google-services.json')!, /credenciales/)
    assert.match(sensitiveFileName('servidor.pem')!, /credenciales/)
    assert.match(sensitiveFileName('medicos_backup.sql')!, /respaldo/)
    assert.equal(sensitiveFileName('init.sql'), null)
    assert.equal(sensitiveFileName('package.json'), null)
  })

  test('recorre el proyecto, nombra el archivo y nunca el valor', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dockyard-rev-'))
    await mkdir(join(root, 'src'))
    await mkdir(join(root, 'node_modules'))
    await writeFile(join(root, '.env'), 'JWT_SECRET=9f8e7d6c5b4a39281706f5e4d3c2b1a0\n')
    await writeFile(join(root, 'src', 'app.js'), `const k = '${googleKey}'`)
    await writeFile(join(root, 'node_modules', 'x.js'), `const k = '${googleKey}'`)
    await writeFile(join(root, 'package-lock.json'), googleKey)
    await writeFile(join(root, 'dato.bin'), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(googleKey)]))
    await writeFile(join(root, 'dump.sql'), 'INSERT')
    await symlink('/etc', join(root, 'sistema'))
    await symlink('src', join(root, 'interno'))

    const warnings = await fileWarnings(root)
    const text = warnings.join('\n')
    assert.equal(warnings.length, 4, text)
    assert.match(text, /^\.env: JWT_SECRET parece una clave real\.$/m)
    assert.match(text, /src\/app\.js: parece contener una clave de Google/)
    assert.match(text, /dump\.sql: parece un respaldo/)
    assert.match(text, /sistema: es un enlace a \/etc/)
    assert.ok(!text.includes(googleKey) && !text.includes('9f8e7d6c'))
    await rm(root, { recursive: true, force: true })
  })
})

describe('revisión del ZIP', () => {
  test('acepta un ZIP normal', () => {
    assert.equal(zipProblem(['compose.yaml', 'src/app.js', 'a..b/c.txt', '..oculto'], 1000), null)
  })
  for (const name of ['../fuera.txt', 'a/../../fuera.txt', '/etc/passwd', '..\\fuera.txt', 'C:\\Windows\\x']) {
    test(`rechaza ${name}`, () => assert.match(zipProblem([name], 10)!, /salir de su carpeta/))
  }
  test('rechaza un ZIP que ocuparía demasiado', () => {
    assert.match(zipProblem(['a'], 4 * 1024 ** 3)!, /3 GB/)
  })
  test('rechaza un ZIP con demasiados archivos', () => {
    assert.match(zipProblem(Array.from({ length: 100_001 }, (_, i) => `f${i}`), 10)!, /más de 100000/)
  })
})

describe('avance del encendido', () => {
  test('reconoce la etapa en la salida real de Docker', () => {
    assert.equal(stageOf('Image busybox:1.36.1 Pulling'), 'Descargando imágenes')
    assert.equal(stageOf('034d6572bf28 Downloading 1.049MB'), 'Descargando imágenes')
    assert.equal(stageOf('Image equipo-web Building'), 'Construyendo imágenes')
    assert.equal(stageOf('#5 [web 2/3] RUN npm ci'), 'Construyendo imágenes')
    assert.equal(stageOf('Network equipo_default Creating'), 'Creando contenedores')
    assert.equal(stageOf('Container equipo-web-1 Started'), 'Arrancando contenedores')
    assert.equal(stageOf('Container equipo-db-1 Waiting'), 'Esperando a que los servicios estén listos')
    assert.equal(stageOf('algo sin relación'), null)
  })

  test('lo que imprime un proyecto al construirse no cambia a otra etapa', () => {
    assert.equal(stageOf('#7 0.5 Container falso Started'), 'Construyendo imágenes')
    assert.equal(stageOf('el servidor ya Started'), null)
    assert.equal(stageOf('web Pulling'), 'Descargando imágenes')
  })

  test('quita colores y caracteres de control, y corta las líneas largas', () => {
    assert.equal(cleanLine('\x1b[32m  listo\x07\x1b[0m '), 'listo')
    assert.equal(cleanLine('x'.repeat(300)).length, 201)
  })

  test('conserva las últimas líneas, sin vacías ni repetidas seguidas', () => {
    let last: StartProgress | undefined
    const tracker = createProgressTracker((progress) => { last = progress })
    tracker.setStage('Inicio')
    assert.deepEqual(last, { stage: 'Inicio', lines: [] })
    tracker.addLine('   ')
    tracker.addLine('sin etapa')
    tracker.addLine('sin etapa')
    assert.deepEqual(last, { stage: 'Inicio', lines: ['sin etapa'] })
    for (let i = 0; i < 10; i++) tracker.addLine(`línea ${i}`)
    assert.equal(last?.lines.length, 8)
    assert.equal(last?.lines.at(-1), 'línea 9')
  })

  test('run entrega las líneas de stdout y stderr, también la última sin salto', async () => {
    const lines: string[] = []
    const out = await run('sh', ['-c', 'printf "a\\nb\\rc"; printf "d\\n" >&2'], { onLine: (line) => lines.push(line) })
    assert.equal(out, 'a\nb\rc')
    assert.deepEqual(lines.sort(), ['a', 'b', 'c', 'd'])
  })
})
