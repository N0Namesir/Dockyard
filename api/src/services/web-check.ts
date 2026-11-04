/** Resultado de pedir la página principal de un proyecto encendido. */
export interface WebCheck {
  /** `ok`: contesta. `error`: contesta con un error del servidor (5xx). `no-response`: no contesta. */
  state: 'ok' | 'error' | 'no-response'
  httpStatus?: number
}

export type CheckWeb = (port: number) => Promise<WebCheck>

/** La lista espera esta comprobación: un proyecto que no contesta la demora hasta este tiempo. */
const TIMEOUT_MS = 2_000

/**
 * Dentro del contenedor, `localhost` es Dockyard y no la PC: los puertos de los proyectos se
 * alcanzan por `PROJECTS_HOST`. Nunca lanza: si la página no contesta, ese es el resultado.
 */
export function createWebChecker(host = process.env.PROJECTS_HOST || 'localhost'): CheckWeb {
  return async (port) => {
    try {
      const response = await fetch(`http://${host}:${port}/`, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      await response.body?.cancel()
      // Un 401, un 404 o un 400 también prueban que la aplicación está viva.
      return response.status >= 500
        ? { state: 'error', httpStatus: response.status }
        : { state: 'ok', httpStatus: response.status }
    } catch {
      return { state: 'no-response' }
    }
  }
}
