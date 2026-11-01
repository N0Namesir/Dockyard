/**
 * Convierte un nombre libre en un nombre de proyecto válido para docker compose:
 * solo minúsculas, dígitos, guiones y guiones bajos, empezando con letra o dígito.
 * No toca el disco y nunca falla: si no queda nada, devuelve "proyecto".
 */
export function normalizeProjectName(name: string): string {
  const normalized = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita tildes y diéresis
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+/, '') // compose exige empezar con letra o dígito
    .replace(/-+$/, '')
  return normalized || 'proyecto'
}

/** Rechaza nombres que no estén normalizados, para no usarlos nunca como carpeta o proyecto. */
export function assertNormalizedName(name: string): void {
  if (!name || normalizeProjectName(name) !== name) {
    throw new Error(`El nombre de proyecto "${name}" no es válido. Usa normalizeProjectName antes de llamar al núcleo.`)
  }
}
