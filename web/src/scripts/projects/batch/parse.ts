// Lectura de la lista de «Varios»: una línea por proyecto, `equipo; nombre; url`. Solo sirve para la
// vista previa; la API vuelve a validar todo y decide.

export interface BatchLine {
  /** Número de línea en el texto, desde 1. */
  line: number
  team: string
  name: string
  repoUrl: string
  /** Nombre técnico que le pondría la API. */
  normalized: string
  /** Qué hay que corregir, o null si se puede enviar. */
  error: string | null
}

/** Igual que normalizeProjectName del núcleo, para avisar antes de enviar si un nombre se repite. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+/, '')
    .replace(/-+$/, '') || 'proyecto'
}

/** Tabuladores si los hay (copiado de una hoja de cálculo), si no punto y coma, si no comas. */
export function splitLine(line: string): string[] {
  const separator = line.includes('\t') ? '\t' : line.includes(';') ? ';' : ','
  return line.split(separator).map((part) => part.trim())
}

/** Las líneas con su error. `taken` son los nombres técnicos que ya existen o se están registrando. */
export function parseBatch(text: string, taken: Set<string>): BatchLine[] {
  const result: BatchLine[] = []
  const seen = new Map<string, number>()
  text.split(/\r?\n/).forEach((raw, index) => {
    if (!raw.trim()) return
    const parts = splitLine(raw)
    const [team = '', name = '', repoUrl = ''] = parts
    const normalized = normalizeName(name)
    let error: string | null = null
    if (parts.length < 3 || !team || !name || !repoUrl) error = 'Línea incompleta: faltan el equipo, el nombre o la URL.'
    else if (parts.length > 3) error = 'Sobran columnas: deben ser equipo, nombre y URL.'
    else if (!/^https:\/\/github\.com\/\S+$/i.test(repoUrl)) error = 'La URL debe ser de GitHub y empezar con https://.'
    else if (seen.has(normalized)) error = `El nombre se repite en la línea ${seen.get(normalized)}.`
    else if (taken.has(normalized)) error = `Ya hay un proyecto llamado ${normalized}.`
    if (!error) seen.set(normalized, index + 1)
    result.push({ line: index + 1, team, name, repoUrl, normalized, error })
  })
  return result
}
