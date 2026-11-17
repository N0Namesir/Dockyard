export class HttpError extends Error {
  readonly statusCode: number
  /** Datos extra que acompañan al mensaje en la respuesta, para que la interfaz ofrezca una salida. */
  readonly details: Record<string, unknown> | undefined

  constructor(statusCode: number, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'HttpError'
    this.statusCode = statusCode
    this.details = details
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Ocurrió un error inesperado.'
}
