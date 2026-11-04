import type { StartProgress } from './types.ts'

/*
 * Avance de `docker compose up -d`, traducido para el docente. Docker escribe sus eventos en stderr
 * (`Container web-1 Starting`) y la salida de la construcción en stdout (`#5 [web 2/3] RUN ...`).
 * Si un formato cambia, solo deja de cambiar la etapa: encender no depende de esto.
 */

const MAX_LINES = 8
const MAX_LINE_LENGTH = 200
/** Colores y movimientos del cursor, y cualquier otro carácter de control. */
const CONTROL_CHARS = /\x1b\[[0-9;?]*[A-Za-z]|[\x00-\x08\x0b-\x1f\x7f]/g

const DOWNLOADING = 'Descargando imágenes'
const BUILDING = 'Construyendo imágenes'

const STAGE_BY_EVENT: Record<string, string> = {
  Pulling: DOWNLOADING,
  Pulled: DOWNLOADING,
  Building: BUILDING,
  Built: BUILDING,
  Creating: 'Creando contenedores',
  Created: 'Creando contenedores',
  Recreate: 'Creando contenedores',
  Recreated: 'Creando contenedores',
  Starting: 'Arrancando contenedores',
  Started: 'Arrancando contenedores',
  Running: 'Arrancando contenedores',
  Waiting: 'Esperando a que los servicios estén listos',
  Healthy: 'Esperando a que los servicios estén listos',
}

export function cleanLine(raw: string): string {
  const line = raw.replace(CONTROL_CHARS, '').trim()
  return line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}…` : line
}

/** Etapa que indica una línea de Docker, o null si no indica ninguna. */
export function stageOf(line: string): string | null {
  // Primero, porque lo que imprime un proyecto al construirse puede contener cualquier palabra.
  if (/^#\d+\s/.test(line)) return BUILDING
  if (/^[0-9a-f]{12}\s/.test(line)) return DOWNLOADING
  // Solo las líneas con la forma de un evento: sin BuildKit, la construcción no lleva el prefijo #.
  const event = /^(?:(?:Image|Network|Volume|Container)\s+)?\S+\s+(\w+)$/.exec(line)?.[1]
  return (event && STAGE_BY_EVENT[event]) || null
}

/** Lleva la etapa y las últimas líneas, y avisa de cada cambio. */
export function createProgressTracker(listener?: (progress: StartProgress) => void) {
  let stage = ''
  const lines: string[] = []
  const notify = () => listener?.({ stage, lines: [...lines] })

  return {
    setStage(text: string): void {
      stage = text
      notify()
    },
    addLine(raw: string): void {
      const line = cleanLine(raw)
      if (!line || line === lines.at(-1)) return
      lines.push(line)
      if (lines.length > MAX_LINES) lines.shift()
      stage = stageOf(line) ?? stage
      notify()
    },
  }
}
