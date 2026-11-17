// Única puerta hacia la API. Convierte las fallas en errores con un mensaje para el docente.

export const CONNECTION_MESSAGE = 'No se puede conectar con Dockyard. Verifica que esté encendido y recarga la página.'
const RETRY_DELAY_MS = 5_000
const MAX_CONNECTION_FAILURES = 5

/** La petición no llegó a responder: la API está caída o el navegador cortó la espera. */
export class ConnectionError extends Error {}

/** La API respondió con un error. */
export class ApiResponseError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, init)
  } catch {
    throw new ConnectionError(CONNECTION_MESSAGE)
  }
  if (!response.ok) {
    let body: { message?: string } = {}
    try {
      body = (await response.json()) as { message?: string }
    } catch {
      // La respuesta sin JSON se convierte en un mensaje estable para el docente.
    }
    throw new ApiResponseError(response.status, body.message ?? 'La operación no pudo completarse.')
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

/**
 * Firefox corta las peticiones pendientes cuando cambian las redes de la PC, y encender un
 * proyecto crea una red de Docker. El servidor sigue trabajando, así que se repite la
 * petición: la API la une a la operación en curso y responde con su resultado real.
 */
export async function requestWithRetries<T>(path: string, method: string, afterCut?: (error: unknown) => T | undefined): Promise<T> {
  let wasCut = false
  for (let failures = 1; ; failures++) {
    try {
      return await api<T>(path, { method })
    } catch (error) {
      if (wasCut && afterCut) {
        const result = afterCut(error)
        if (result !== undefined) return result
      }
      if (!(error instanceof ConnectionError) || failures >= MAX_CONNECTION_FAILURES) throw error
      wasCut = true
      await new Promise((done) => setTimeout(done, RETRY_DELAY_MS))
    }
  }
}

/** Mensaje de un error para mostrarlo, o el texto de respaldo si no trae uno. */
export function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}
