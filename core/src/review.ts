import { lstat, open, readdir, readlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { docker } from './docker.ts'
import { assertNormalizedName } from './name.ts'
import { findComposeFile, projectsDir } from './paths.ts'

/*
 * Revisión de un proyecto recién registrado. Solo lee: nada del proyecto se ejecuta, y
 * `docker compose config` solo interpreta el archivo. Avisa de lo que encuentra, pero no es una
 * auditoría: un proyecto sin avisos no queda garantizado como seguro.
 *
 * Los avisos nunca incluyen el valor de una clave, solo dónde está.
 */

const REVIEW_TIMEOUT = 30_000
const MAX_WARNINGS = 30
const MAX_FILES = 50_000
const MAX_FILE_BYTES = 1024 * 1024
const SKIPPED_DIRS = new Set(['.git', 'node_modules', 'vendor', 'dist', 'build', '__pycache__', '.venv', 'venv'])
/** Sus sumas de verificación se parecen a una clave y no pueden contener una. */
const SKIPPED_FILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'composer.lock', 'poetry.lock'])

const DANGEROUS_CAPS = new Set(['ALL', 'SYS_ADMIN', 'SYS_MODULE', 'SYS_PTRACE', 'SYS_RAWIO', 'DAC_READ_SEARCH'])

function isInside(path: string, root: string): boolean {
  const rel = relative(root, resolve(root, path))
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

/** Lo que permite a un proyecto salir de su contenedor, a partir de `config --format json`. */
export function composeWarnings(config: any, root: string): string[] {
  const warnings: string[] = []

  for (const [service, def] of Object.entries<any>(config?.services ?? {})) {
    const add = (text: string) => warnings.push(`Servicio ${service}: ${text}`)

    if (def?.privileged) add('usa privileged, que le da control total de la PC.')
    for (const key of ['network_mode', 'pid', 'ipc', 'uts', 'userns_mode']) {
      const value = String(def?.[key] ?? '')
      if (value === 'host') add(`usa ${key}: host, que le da acceso directo a la PC.`)
      else if (value.startsWith('container:')) add(`usa ${key}: ${value}, que lo une a un contenedor ajeno.`)
    }
    const caps = (def?.cap_add ?? []).filter((cap: string) => DANGEROUS_CAPS.has(String(cap).replace(/^CAP_/, '')))
    if (caps.length > 0) add(`pide permisos peligrosos (${caps.join(', ')}).`)
    if ((def?.security_opt ?? []).some((opt: string) => /unconfined/.test(String(opt)))) {
      add('desactiva protecciones de seguridad con security_opt.')
    }
    if ((def?.devices ?? []).length > 0) add('accede a dispositivos de la PC.')
    if ((def?.volumes_from ?? []).some((from: string) => String(from).startsWith('container:'))) {
      add('usa los volúmenes de un contenedor ajeno.')
    }

    for (const volume of def?.volumes ?? []) {
      if (volume?.type !== 'bind' || typeof volume.source !== 'string') continue
      if (/(^|\/)docker\.sock$/.test(volume.source)) {
        add('monta docker.sock, que le da control de Docker y de toda la PC.')
      } else if (!isInside(volume.source, root)) {
        add(`monta ${volume.source}, una ruta de la PC fuera del proyecto.`)
      }
    }

    const contexts = [def?.build?.context, ...Object.values(def?.build?.additional_contexts ?? {})]
    for (const context of contexts) {
      if (typeof context !== 'string' || /^[a-z][a-z0-9+.-]*:/i.test(context)) continue
      if (!isInside(context, root)) add(`se construye con ${context}, una ruta fuera del proyecto.`)
    }
  }

  for (const [name, def] of Object.entries<any>(config?.volumes ?? {})) {
    const device = def?.driver_opts?.device
    if (typeof device === 'string' && device.startsWith('/') && !isInside(device, root)) {
      warnings.push(`Volumen ${name}: apunta a ${device}, una ruta de la PC fuera del proyecto.`)
    }
  }
  for (const section of ['secrets', 'configs']) {
    for (const [name, def] of Object.entries<any>(config?.[section] ?? {})) {
      if (typeof def?.file === 'string' && !isInside(def.file, root)) {
        warnings.push(`${section === 'secrets' ? 'Secreto' : 'Configuración'} ${name}: lee ${def.file}, una ruta fuera del proyecto.`)
      }
    }
  }
  return warnings
}

const SECRET_PATTERNS: [string, RegExp][] = [
  ['una clave de Google', /\bAIza[0-9A-Za-z_-]{35}/],
  ['una clave de Groq', /\bgsk_[A-Za-z0-9]{20,}/],
  ['una clave de OpenAI', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/],
  ['una clave de Anthropic', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['una clave de Stripe', /\b[sr]k_live_[A-Za-z0-9]{16,}/],
  ['un token de GitHub', /\b(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{20,})/],
  ['una clave de AWS', /\bAKIA[0-9A-Z]{16}\b/],
  ['un token de Slack', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['una clave privada', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
]

/** Claves que un archivo de texto parece contener. Solo su tipo, nunca su valor. */
export function secretsIn(text: string): string[] {
  return SECRET_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([label]) => label)
}

/** Variables de un .env cuyo valor parece una clave de verdad y no un ejemplo. Solo sus nombres. */
export function suspiciousEnvVars(text: string): string[] {
  const names: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    const name = match[1]!
    const value = match[2]!.trim().replace(/^["']|["']$/g, '')
    if (!/(KEY|SECRET|TOKEN)/i.test(name)) continue
    if (value.length < 20 || /\$\{|\s/.test(value)) continue
    if (/change|cambia|example|ejemplo|your|tu[_-]|placeholder|xxx|demo|test|prueba|local/i.test(value)) continue
    if (/[a-z]/i.test(value) && /[0-9]/.test(value)) names.push(name)
  }
  return names
}

/** Aviso según el nombre del archivo, si parece una credencial o un respaldo de datos. */
export function sensitiveFileName(name: string): string | null {
  const lower = name.toLowerCase()
  if (/^(google-services\.json|googleservice-info\.plist|credentials\.json|id_rsa|id_ed25519)$/.test(lower)
    || /^service-?account.*\.json$/.test(lower)
    || /\.(pem|key|p12|pfx|jks|keystore)$/.test(lower)) {
    return 'parece un archivo de credenciales'
  }
  if (/(dump|backup|respaldo).*\.sql$/.test(lower) || /\.(dump|bak)$/.test(lower)) {
    return 'parece un respaldo de una base de datos, que podría traer datos reales'
  }
  return null
}

async function readTextHead(path: string): Promise<string | null> {
  const file = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(MAX_FILE_BYTES)
    const { bytesRead } = await file.read(buffer, 0, MAX_FILE_BYTES, 0)
    const content = buffer.subarray(0, bytesRead)
    return content.subarray(0, 8192).includes(0) ? null : content.toString('utf8')
  } finally {
    await file.close()
  }
}

/** Busca enlaces que salen del proyecto, archivos de credenciales y claves escritas en el código. */
export async function fileWarnings(root: string): Promise<string[]> {
  const warnings: string[] = []
  let seen = 0
  const pending = [root]

  while (pending.length > 0) {
    const dir = pending.pop()!
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      const shown = relative(root, path)
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) pending.push(path)
        continue
      }
      if (entry.isSymbolicLink()) {
        const target = await readlink(path)
        if (!isInside(resolve(dirname(path), target), root)) {
          warnings.push(`${shown}: es un enlace a ${target}, fuera del proyecto.`)
        }
        continue
      }
      if (!entry.isFile()) continue
      if (++seen > MAX_FILES) {
        warnings.push(`El proyecto tiene más de ${MAX_FILES} archivos y no se revisaron todos.`)
        return warnings
      }

      const sensitive = sensitiveFileName(entry.name)
      if (sensitive) warnings.push(`${shown}: ${sensitive}.`)
      if (SKIPPED_FILES.has(entry.name) || (await lstat(path)).size > MAX_FILE_BYTES) continue

      const text = await readTextHead(path).catch(() => null)
      if (text === null) continue
      const secrets = secretsIn(text)
      if (secrets.length > 0) warnings.push(`${shown}: parece contener ${secrets.join(', ')}.`)
      if (/^\.env(\..*)?$/.test(basename(entry.name))) {
        const names = suspiciousEnvVars(text)
        if (names.length > 0) warnings.push(`${shown}: ${names.join(', ')} parece${names.length > 1 ? 'n' : ''} una clave real.`)
      }
    }
  }
  return warnings
}

function limited(warnings: string[]): string[] {
  const unique = [...new Set(warnings)]
  if (unique.length <= MAX_WARNINGS) return unique
  return [...unique.slice(0, MAX_WARNINGS), `Y ${unique.length - MAX_WARNINGS} avisos más.`]
}

/**
 * Revisa un proyecto ya preparado y devuelve avisos para el docente, sin encenderlo. No lanza por
 * lo que encuentre en el proyecto: si algo no se pudo revisar, también lo avisa.
 */
export async function reviewProject(dir: string, name: string): Promise<string[]> {
  assertNormalizedName(name)
  const root = join(projectsDir(), name)
  const warnings: string[] = []

  try {
    const location = await findComposeFile(dir)
    if (!location) throw new Error('sin archivo compose')
    const out = await docker(
      ['compose', '-p', name, '--project-directory', location.dir, '-f', location.file, 'config', '--format', 'json'],
      { timeoutMs: REVIEW_TIMEOUT },
    )
    warnings.push(...composeWarnings(JSON.parse(out), root))
  } catch {
    warnings.push('No se pudo revisar el archivo compose: puede tener errores. Revísalo antes de encender.')
  }

  try {
    warnings.push(...await fileWarnings(root))
  } catch {
    warnings.push('No se pudieron revisar todos los archivos del proyecto.')
  }
  return limited(warnings)
}
