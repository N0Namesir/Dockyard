import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface RunOptions {
  cwd?: string
  timeoutMs?: number
  /** Códigos de salida distintos de 0 que también cuentan como éxito (unzip usa 1 para advertencias). */
  okExitCodes?: number[]
  /** Recibe cada línea de stdout y stderr mientras el comando corre. */
  onLine?: (line: string) => void
}

/** Error de un comando externo. `stderr` conserva la salida completa para poder clasificar la falla. */
export class CommandError extends Error {
  readonly stderr: string
  readonly timedOut: boolean

  constructor(message: string, stderr: string, timedOut: boolean) {
    super(message)
    this.name = 'CommandError'
    this.stderr = stderr
    this.timedOut = timedOut
  }
}

/** Entrega un flujo línea por línea. Docker separa con \r las que redibuja. */
function followLines(stream: NodeJS.ReadableStream | null, onLine: (line: string) => void): void {
  let rest = ''
  stream?.on('data', (chunk) => {
    const parts = (rest + String(chunk)).split(/[\r\n]+/)
    rest = parts.pop() ?? ''
    parts.forEach(onLine)
  })
  stream?.on('end', () => {
    if (rest) onLine(rest)
  })
}

/**
 * Ejecuta un comando con una lista de argumentos y devuelve su salida estándar.
 * Nunca pasa por un shell: los datos del docente no pueden inyectar comandos.
 */
export async function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 120_000
  try {
    const running = execFileAsync(cmd, args, {
      cwd: opts.cwd,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    })
    if (opts.onLine) {
      followLines(running.child.stdout, opts.onLine)
      followLines(running.child.stderr, opts.onLine)
    }
    const { stdout } = await running
    return stdout
  } catch (err: any) {
    if (typeof err.code === 'number' && opts.okExitCodes?.includes(err.code)) {
      return String(err.stdout ?? '')
    }
    if (err.code === 'ENOENT') {
      throw new CommandError(`No se encontró el programa ${cmd}. Instálalo en esta máquina e intenta de nuevo.`, '', false)
    }
    const stderr = String(err.stderr || err.message || '').trim()
    if (err.killed && err.signal) {
      const minutes = Math.round(timeoutMs / 60_000)
      const limit = minutes >= 1 ? `${minutes} min` : `${Math.round(timeoutMs / 1000)} s`
      throw new CommandError(`${cmd} tardó más de ${limit} y se canceló.`, stderr, true)
    }
    const detail = stderr.split('\n').slice(-5).join('\n')
    throw new CommandError(`${cmd} falló: ${detail}`, stderr, false)
  }
}
