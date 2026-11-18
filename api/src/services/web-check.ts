/** Resultado de pedir la página principal de un proyecto encendido. */
export interface WebCheck {
  /**
   * `ok`: contesta. `error`: contesta con un error del servidor (5xx). `no-response`: no contesta.
   * `unchecked`: no se puede comprobar desde Dockyard (puerto solo de 127.0.0.1 y Dockyard en contenedor).
   */
  state: 'ok' | 'error' | 'no-response' | 'unchecked'
  httpStatus?: number
}

export interface WebCheckOptions {
  /** El puerto se publicó solo en 127.0.0.1 (o ::1). */
  loopbackOnly?: boolean
}

export type CheckWeb = (port: number, options?: WebCheckOptions) => Promise<WebCheck>

/** La lista espera esta comprobación: un proyecto que no contesta la demora hasta este tiempo. */
const TIMEOUT_MS = 2_000

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/**
 * Dentro del contenedor, `localhost` es Dockyard y no la PC: los puertos de los proyectos se
 * alcanzan por `PROJECTS_HOST`. Nunca lanza: si la página no contesta, ese es el resultado.
 */
export function createWebChecker(host = process.env.PROJECTS_HOST || 'localhost'): CheckWeb {
  // Un puerto publicado solo en 127.0.0.1 de la PC no se alcanza desde el contenedor: diría que no
  // responde aunque abra en el navegador. No se cambia la red de Dockyard para esto.
  const reachesLoopback = LOCAL_HOSTS.has(host)
  return async (port, options = {}) => {
    if (options.loopbackOnly && !reachesLoopback) return { state: 'unchecked' }
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
