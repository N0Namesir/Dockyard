// Pruebas que no necesitan Docker: npm test -w core

import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { diskUsageFrom, isOldVersion, projectImagesFrom } from '../src/disk.ts'
import { parsePs, portInUseMessage, portsInUse, requestedContainerNames, requestedPorts, statusFromContainers, statusesFromContainers } from '../src/docker.ts'
import { assertNormalizedName, normalizeProjectName } from '../src/name.ts'
import { findComposeFile, projectRepoDir, projectsDir } from '../src/paths.ts'
import { cleanLine, createProgressTracker, stageOf } from '../src/progress.ts'
import { composeWarnings, fileWarnings, secretsIn, sensitiveFileName, suspiciousEnvVars } from '../src/review.ts'
import { parseBytes, resourcesFrom } from '../src/resources.ts'
import { run } from '../src/run.ts'
import { cloneProgressOf, cloneRepo, updateProject, zipProblem } from '../src/sources.ts'
import { getLatestVersion, isNewerVersion, latestVersionTag } from '../src/version.ts'
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

describe('statusesFromContainers', () => {
  const row = (project: string, service: string, State: string, Status: string, Ports = '', oneoff = 'False') => ({
    Labels: `com.docker.compose.oneoff=${oneoff},com.docker.compose.project=${project},com.docker.compose.service=${service}`,
    Names: `${project}-${service}-1`,
    State,
    Status,
    Ports,
  })

  test('agrupa por proyecto y lee puertos y códigos de salida de docker ps', () => {
    assert.deepEqual(
      statusesFromContainers([
        row('tienda', 'web', 'running', 'Up 2 minutes', '0.0.0.0:8101->80/tcp, [::]:8101->80/tcp'),
        row('tienda', 'db', 'running', 'Up 2 minutes', '5432/tcp'),
        row('tienda', 'api', 'exited', 'Exited (1) 1 minute ago'),
        row('blog', 'web', 'exited', 'Exited (0) 3 hours ago'),
        row('panel', 'web', 'running', 'Up 5 seconds', '127.0.0.1:8201-8202->80-81/tcp'),
      ]),
      {
        tienda: { state: 'running', ports: [8101], failedServices: ['api'] },
        blog: { state: 'stopped', ports: [] },
        panel: { state: 'running', ports: [8201, 8202], loopbackPorts: [8201, 8202] },
      },
    )
  })

  test('un contenedor que se reinicia cuenta como encendido y como falla', () => {
    assert.deepEqual(statusesFromContainers([row('tienda', 'web', 'restarting', 'Restarting (1) 4 seconds ago')]), {
      tienda: { state: 'running', ports: [], failedServices: ['web'] },
    })
  })

  test('ignora los contenedores de compose run y los que no son de compose', () => {
    assert.deepEqual(
      statusesFromContainers([
        row('tienda', 'web', 'running', 'Up 1 minute', '', 'True'),
        { Labels: '', Names: 'suelto', State: 'running', Status: 'Up 1 minute', Ports: '' },
      ]),
      {},
    )
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
      used.map((u) => `${u.host} ${u.port}/${u.protocol} ${u.container} ${u.project}`),
      [
        '0.0.0.0 8081/tcp prueba-estatico-web-1 prueba-estatico',
        '[::] 8081/tcp prueba-estatico-web-1 prueba-estatico',
        '127.0.0.1 8000/tcp suelto null',
        '127.0.0.1 8001/tcp suelto null',
        '127.0.0.1 8002/tcp suelto null',
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

describe('avance del clonado', () => {
  test('traduce las líneas de git y descarta las demás', () => {
    assert.deepEqual(cloneProgressOf('Receiving objects:  45% (450/1000), 1.20 MiB | 2.00 MiB/s'), { stage: 'Descargando el repositorio', percent: 45 })
    assert.deepEqual(cloneProgressOf('Resolving deltas: 100% (12/12), done.'), { stage: 'Procesando el repositorio', percent: 100 })
    assert.deepEqual(cloneProgressOf('Updating files:   7% (3/40)'), { stage: 'Copiando los archivos', percent: 7 })
    assert.equal(cloneProgressOf('remote: Counting objects: 100% (5/5), done.'), null)
    assert.equal(cloneProgressOf("Cloning into '/projects/tienda'..."), null)
  })
})

describe('actualizar desde el repositorio', () => {
  const COMPOSE = 'services:\n  web:\n    image: nginx:alpine\n'
  const IDENTITY = ['-c', 'user.name=Prueba', '-c', 'user.email=prueba@example.invalid']
  const previousDir = process.env.PROJECTS_DIR
  let base = ''
  let origin = ''
  let count = 0

  const inOrigin = (...args: string[]) => run('git', ['-C', origin, ...IDENTITY, ...args])
  const exists = (path: string) => access(path).then(() => true, () => false)

  async function commit(message: string, files: Record<string, string | null>) {
    for (const [file, content] of Object.entries(files)) {
      if (content === null) await unlink(join(origin, file))
      else {
        await mkdir(join(origin, file, '..'), { recursive: true })
        await writeFile(join(origin, file), content)
      }
    }
    await inOrigin('add', '-A')
    await inOrigin('commit', '-q', '-m', message)
  }

  /** Un origen con compose y dos archivos, y un proyecto ya clonado de él. */
  async function setup() {
    base = await mkdtemp(join(tmpdir(), 'dockyard-actualizar-'))
    process.env.PROJECTS_DIR = join(base, 'projects')
    origin = join(base, 'origen')
    await mkdir(origin)
    await inOrigin('init', '-q')
    await commit('Primera', { 'compose.yaml': COMPOSE, 'a.txt': 'uno', 'b.txt': 'borrar' })
    const name = `equipo-${++count}`
    const root = join(projectsDir(), name)
    await cloneRepo(`file://${origin}`, root, projectRepoDir(name))
    return { name, root }
  }

  after(() => {
    if (previousDir === undefined) delete process.env.PROJECTS_DIR
    else process.env.PROJECTS_DIR = previousDir
  })

  test('el clonado informa su avance línea por línea', async () => {
    base = await mkdtemp(join(tmpdir(), 'dockyard-actualizar-'))
    process.env.PROJECTS_DIR = join(base, 'projects')
    origin = join(base, 'origen')
    await mkdir(origin)
    await inOrigin('init', '-q')
    await commit('Primera', { 'compose.yaml': COMPOSE })
    const stages = new Set<string>()
    await cloneRepo(`file://${origin}`, join(projectsDir(), 'avance'), projectRepoDir('avance'), (line) => {
      const progress = cloneProgressOf(line)
      if (progress) stages.add(progress.stage)
    })
    assert.ok(stages.has('Descargando el repositorio'), [...stages].join(', '))
    await rm(base, { recursive: true, force: true })
  })

  test('el repositorio queda fuera de la carpeta que ven los contenedores', async () => {
    const { name, root } = await setup()
    assert.equal(await exists(join(root, '.git')), false)
    assert.equal(await exists(join(projectRepoDir(name), 'HEAD')), true)
    await rm(base, { recursive: true, force: true })
  })

  test('sin cambios lo dice', async () => {
    const { name, root } = await setup()
    const update = await updateProject(name)
    assert.equal(update.changed, false)
    assert.equal(update.dir, root)
    assert.equal(update.summary, 'Primera')
    await rm(base, { recursive: true, force: true })
  })

  test('aplica cambios y borrados, y conserva lo que no viene en el repositorio', async () => {
    const { name, root } = await setup()
    await writeFile(join(root, '.env'), 'CLAVE=local')
    await mkdir(join(root, 'datos'))
    await writeFile(join(root, 'datos', 'subida.png'), 'x')
    await commit('Segunda', { 'a.txt': 'dos', 'b.txt': null, 'nuevo.txt': 'hola' })

    const update = await updateProject(name)
    assert.equal(update.changed, true)
    assert.equal(update.summary, 'Segunda')
    assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'dos')
    assert.equal(await readFile(join(root, 'nuevo.txt'), 'utf8'), 'hola')
    assert.equal(await exists(join(root, 'b.txt')), false)
    assert.equal(await readFile(join(root, '.env'), 'utf8'), 'CLAVE=local')
    assert.equal(await exists(join(root, 'datos', 'subida.png')), true)
    assert.equal((await updateProject(name)).changed, false)
    await rm(base, { recursive: true, force: true })
  })

  test('funciona aunque el equipo haya reescrito la historia', async () => {
    const { name, root } = await setup()
    await writeFile(join(origin, 'a.txt'), 'reescrito')
    await inOrigin('add', '-A')
    await inOrigin('commit', '-q', '--amend', '-m', 'Reescrita')
    assert.equal((await updateProject(name)).summary, 'Reescrita')
    assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'reescrito')
    await rm(base, { recursive: true, force: true })
  })

  test('no pisa un archivo cambiado en la PC, y se puede actualizar lo demás después', async () => {
    const { name, root } = await setup()
    await writeFile(join(root, 'a.txt'), 'cambio local')
    await commit('Segunda', { 'a.txt': 'dos', 'nuevo.txt': 'hola' })
    await assert.rejects(updateProject(name), /pisaría un archivo .*a\.txt/)
    assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'cambio local')
    assert.equal(await exists(join(root, 'nuevo.txt')), false)

    await writeFile(join(root, 'a.txt'), 'uno')
    assert.equal((await updateProject(name)).changed, true)
    assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'dos')
    await rm(base, { recursive: true, force: true })
  })

  test('tampoco pisa un archivo sin versionar que la versión nueva trae', async () => {
    const { name, root } = await setup()
    await writeFile(join(root, '.env'), 'CLAVE=local')
    await commit('Trae .env', { '.env': 'CLAVE=del-repo' })
    await assert.rejects(updateProject(name), /pisaría un archivo/)
    assert.equal(await readFile(join(root, '.env'), 'utf8'), 'CLAVE=local')
    await rm(base, { recursive: true, force: true })
  })

  test('si la versión nueva no trae compose, deja el proyecto como estaba', async () => {
    const { name, root } = await setup()
    await commit('Sin compose', { 'compose.yaml': null, 'a.txt': 'dos' })
    await assert.rejects(updateProject(name), /ya no trae un archivo compose/)
    assert.equal(await readFile(join(root, 'compose.yaml'), 'utf8'), COMPOSE)
    assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'uno')

    await commit('Con compose', { 'compose.yaml': COMPOSE })
    assert.equal((await updateProject(name)).summary, 'Con compose')
    assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'dos')
    await rm(base, { recursive: true, force: true })
  })

  test('sigue al compose si cambia de carpeta y copia un .env.example nuevo', async () => {
    const { name, root } = await setup()
    await commit('Mueve', {
      'compose.yaml': null,
      'a.txt': null,
      'b.txt': null,
      'app/compose.yaml': COMPOSE,
      'app/.env.example': 'CLAVE=ejemplo',
    })
    const update = await updateProject(name)
    assert.equal(update.dir, join(root, 'app'))
    assert.equal(await readFile(join(root, 'app', '.env'), 'utf8'), 'CLAVE=ejemplo')
    await rm(base, { recursive: true, force: true })
  })

  test('un .git plantado en la carpeta del proyecto no se usa', async () => {
    const { name, root } = await setup()
    const marker = join(base, 'hook-ejecutado')
    await mkdir(join(root, '.git', 'hooks'), { recursive: true })
    await writeFile(join(root, '.git', 'config'), `[core]\n\tfsmonitor = touch ${marker}\n\thooksPath = ${join(root, '.git', 'hooks')}\n`)
    await writeFile(join(root, '.git', 'hooks', 'post-merge'), `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o755 })
    await commit('Segunda', { 'a.txt': 'dos' })
    assert.equal((await updateProject(name)).changed, true)
    assert.equal(await exists(marker), false)
    await rm(base, { recursive: true, force: true })
  })

  test('un proyecto sin repositorio pide registrarlo de nuevo', async () => {
    await setup()
    await assert.rejects(updateProject('sin-repositorio'), /regístralo de nuevo/)
    await rm(base, { recursive: true, force: true })
  })

  test('un origen que ya no existe da un mensaje claro y no cambia nada', async () => {
    const { name, root } = await setup()
    await rm(origin, { recursive: true, force: true })
    await assert.rejects(updateProject(name), /No se pudo descargar la actualización/)
    assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'uno')
    await rm(base, { recursive: true, force: true })
  })
})

describe('consumo de recursos', () => {
  test('entiende las unidades de Docker', () => {
    assert.equal(parseBytes('512B'), 512)
    assert.equal(parseBytes('1.5kB'), 1500)
    assert.equal(parseBytes('107.1MiB'), Math.round(107.1 * 1024 ** 2))
    assert.equal(parseBytes(' 22.77GiB'), Math.round(22.77 * 1024 ** 3))
    assert.equal(parseBytes('--'), 0)
  })

  const labels = (project: string, service: string) =>
    `com.docker.compose.oneoff=False,com.docker.compose.project=${project},com.docker.compose.service=${service}`

  test('agrupa por proyecto y expresa la CPU sobre toda la PC', () => {
    const usage = resourcesFrom(
      [
        { ID: 'a1', Names: 'a-web-1', Labels: labels('a', 'web') },
        { ID: 'a2', Names: 'a-db-1', Labels: labels('a', 'db') },
        { ID: 'b1', Names: 'b-web-1', Labels: labels('b', 'web') },
      ],
      [
        { ID: 'a1', CPUPerc: '200.00%', MemUsage: '100MiB / 1GiB' },
        { ID: 'a2', CPUPerc: '100.00%', MemUsage: '50MiB / 1GiB' },
        { ID: 'b1', CPUPerc: '4.00%', MemUsage: '10MiB / 1GiB' },
      ],
      4,
    )
    assert.equal(usage.memoryLimit, 1024 ** 3)
    assert.equal(usage.projects.a!.cpuPercent, 75)
    assert.equal(usage.projects.a!.memoryBytes, 150 * 1024 ** 2)
    assert.deepEqual(usage.projects.a!.services.map((service) => service.service), ['web', 'db'])
    assert.equal(usage.projects.b!.cpuPercent, 1)
  })

  test('ignora contenedores sin compose o sin muestra, y datos que aún no existen', () => {
    const usage = resourcesFrom(
      [
        { ID: 'x', Names: 'suelto', Labels: 'otra=1' },
        { ID: 'y', Names: 'y-web-1', Labels: labels('y', 'web') },
        { ID: 'z', Names: 'z-web-1', Labels: labels('z', 'web') },
      ],
      [
        { ID: 'x', CPUPerc: '9%', MemUsage: '1MiB / 1GiB' },
        { ID: 'z', CPUPerc: '--', MemUsage: '-- / --' },
      ],
      2,
    )
    assert.deepEqual(Object.keys(usage.projects), ['z'])
    assert.equal(usage.projects.z!.cpuPercent, 0)
    assert.equal(usage.projects.z!.memoryBytes, 0)
  })
})

describe('versiones', () => {
  const refs = (...tags: string[]) => tags.map((tag) => `abc123\trefs/tags/${tag}`).join('\n')

  test('compara por número, no por texto', () => {
    assert.equal(isNewerVersion('v1.10.0', '1.9.0'), true)
    assert.equal(isNewerVersion('v2.0.0', '1.99.99'), true)
    assert.equal(isNewerVersion('v1.0.0', '1.0.0'), false)
    assert.equal(isNewerVersion('v0.9.0', '1.0.0'), false)
  })

  test('una versión con otro formato nunca es más nueva', () => {
    assert.equal(isNewerVersion('v9.0.0-beta', '1.0.0'), false)
    assert.equal(isNewerVersion('v9.0.0', 'desconocida'), false)
  })

  test('elige la etiqueta más alta e ignora las que no son vX.Y.Z', () => {
    const tags = ['v1.2.0', 'v1.10.0', 'v1.9.9', 'v9.0.0-rc1', '9.0.0', 'latest', 'v9.0', 'v09.0.0', 'v9.0.0.0', 'x/v9.0.0']
    assert.equal(latestVersionTag(refs(...tags)), 'v1.10.0')
  })

  test('sin etiquetas válidas no hay versión', () => {
    assert.equal(latestVersionTag(''), null)
    assert.equal(latestVersionTag(refs('borrador')), null)
    assert.equal(latestVersionTag('abc123\trefs/heads/v9.0.0'), null)
  })

  test('lee las etiquetas de un repositorio de verdad, sin red', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dockyard-version-'))
    try {
      const git = (...args: string[]) => run('git', ['-C', dir, '-c', 'user.name=Prueba', '-c', 'user.email=prueba@example.invalid', ...args])
      await git('init', '-q')
      assert.equal(await getLatestVersion(`file://${dir}`), null)
      await git('commit', '-q', '--allow-empty', '-m', 'Inicio')
      await git('tag', 'v1.0.0')
      await git('tag', '-a', 'v1.2.0', '-m', 'Etiqueta anotada')
      await git('tag', 'v2.0.0-beta')
      assert.equal(await getLatestVersion(`file://${dir}`), 'v1.2.0')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('si no se puede consultar, lo dice en español', async () => {
    await assert.rejects(getLatestVersion('file:///no/existe/dockyard'), /No se pudo consultar la última versión/)
  })
})

describe('espacio en disco', () => {
  // Salida real de `docker system df -v --format json` (almacén clásico, Docker 29.10), recortada.
  const df = {
    Images: [
      { Containers: '1', ID: 'sha256:actual', Repository: 'tienda-app', Tag: 'latest', Size: '245MB', UniqueSize: '230.7MB' },
      { Containers: '0', ID: 'sha256:vieja', Repository: '<none>', Tag: '<none>', Size: '244MB', UniqueSize: '12.5MB' },
      { Containers: '0', ID: 'sha256:tras-reiniciar', Repository: 'biblioteca-web', Tag: 'latest', Size: '1.2GB', UniqueSize: 'N/A' },
      { Containers: '0', ID: 'sha256:ajena', Repository: '<none>', Tag: '<none>', Size: '3GB', UniqueSize: '3GB' },
      { Containers: '2', ID: 'sha256:postgres', Repository: 'postgres', Tag: '16-alpine', Size: '400MB', UniqueSize: '400MB' },
    ],
    Volumes: [
      { Name: 'tienda_datos', Labels: 'com.docker.compose.project=tienda,com.docker.compose.version=5.7.1,com.docker.compose.volume=datos', Size: '48.2MB' },
      { Name: 'suelto', Labels: '', Size: '9GB' },
    ],
  }
  const projectById = new Map([
    ['sha256:actual', 'tienda'],
    ['sha256:vieja', 'tienda'],
    ['sha256:tras-reiniciar', 'biblioteca'],
    ['sha256:ajena', 'otro-de-la-pc'],
  ])

  test('solo cuenta las imágenes con etiqueta de compose y distingue las versiones viejas', () => {
    const images = projectImagesFrom(df, projectById)
    assert.deepEqual(images.map((image) => [image.id, image.project, isOldVersion(image)]), [
      ['sha256:actual', 'tienda', false],
      ['sha256:vieja', 'tienda', true],
      ['sha256:tras-reiniciar', 'biblioteca', false],
      ['sha256:ajena', 'otro-de-la-pc', true],
    ])
    // Sin UniqueSize, lo que se recupera es todo su tamaño.
    assert.equal(images[2]!.uniqueBytes, 1_200_000_000)
  })

  test('suma imágenes, versiones viejas y volúmenes por proyecto', () => {
    const usage = diskUsageFrom(projectImagesFrom(df, projectById), df.Volumes)
    assert.deepEqual(usage.projects.tienda, { imageBytes: 245_000_000, unusedImageBytes: 12_500_000, volumeBytes: 48_200_000 })
    assert.deepEqual(usage.projects.biblioteca, { imageBytes: 1_200_000_000, unusedImageBytes: 0, volumeBytes: 0 })
    assert.equal(Object.keys(usage.projects).length, 3, 'el volumen sin proyecto y postgres no son de nadie')
  })

  test('una imagen sin nombre que usa un contenedor apagado no es una versión vieja', () => {
    const [image] = projectImagesFrom(
      { Images: [{ Containers: '1', ID: 'x', Repository: '<none>', Tag: '<none>', Size: '1MB', UniqueSize: '1MB' }] },
      new Map([['x', 'tienda']]),
    )
    assert.equal(isOldVersion(image!), false)
  })
})

describe('puertos ocupados y publicados solo en esta PC', () => {
  test('reconoce el puerto ocupado por un programa que no es Docker, en cada forma que lo escribe Docker', () => {
    const outside = (port: number) => `El puerto ${port} ya lo usa otro programa de esta PC que no es un proyecto de Docker. Ciérralo o cambia el puerto en el compose del proyecto.`
    // Salida real de Docker 29.10 con un programa escuchando en 8094.
    assert.equal(portInUseMessage(' Container exp-web-1 Error response from daemon: failed to set up container networking: driver failed programming external connectivity on endpoint exp-web-1 (3fc6…): failed to bind host port 0.0.0.0:8094/tcp: address already in use\nError response from daemon: …'), outside(8094))
    assert.equal(portInUseMessage('Error starting userland proxy: listen tcp4 0.0.0.0:3000: bind: address already in use'), outside(3000))
    assert.equal(portInUseMessage('ports are not available: exposing port TCP [::]:5173 -> 0.0.0.0:0: listen tcp6 [::]:5173: bind: address already in use'), outside(5173))
    assert.match(portInUseMessage('Bind for 0.0.0.0:8081 failed: port is already allocated')!, /^El puerto 8081 ya lo usa otro contenedor de Docker/)
    assert.match(portInUseMessage('bind: address already in use')!, /^Un puerto del proyecto ya lo usa otro programa/)
    assert.equal(portInUseMessage('pull access denied for nada'), null)
  })

  test('un puerto es solo de esta PC si todas sus publicaciones son en 127.0.0.1 o ::1', () => {
    const status = statusFromContainers([
      { State: 'running', Service: 'web', Publishers: [{ URL: '127.0.0.1', PublishedPort: 8101 }, { URL: '::1', PublishedPort: 8101 }] },
      { State: 'running', Service: 'api', Publishers: [{ URL: '0.0.0.0', PublishedPort: 8102 }, { URL: '::', PublishedPort: 8102 }] },
      { State: 'running', Service: 'mixto', Publishers: [{ URL: '127.0.0.1', PublishedPort: 8103 }, { URL: '0.0.0.0', PublishedPort: 8103 }] },
    ])
    assert.deepEqual(status, { state: 'running', ports: [8101, 8102, 8103], loopbackPorts: [8101] })
    assert.equal(statusFromContainers([{ State: 'running', Publishers: [{ URL: '0.0.0.0', PublishedPort: 80 }] }]).loopbackPorts, undefined)
  })
})
