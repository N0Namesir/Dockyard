import { composeProjectOf, composeServiceOf, docker, parsePs } from './docker.ts'
import { CommandError } from './run.ts'
import type { ProjectResources, ResourceUsage } from './types.ts'

const STATS_TIMEOUT = 20_000
const UNITS: Record<string, number> = {
  B: 1,
  KB: 1000,
  MB: 1000 ** 2,
  GB: 1000 ** 3,
  TB: 1000 ** 4,
  KIB: 1024,
  MIB: 1024 ** 2,
  GIB: 1024 ** 3,
  TIB: 1024 ** 4,
}

/** Convierte "107.1MiB" a bytes. Docker escribe "--" si aún no tiene el dato. */
export function parseBytes(text: string): number {
  const match = /^([\d.]+)\s*([a-z]+)$/i.exec(text.trim())
  if (!match) return 0
  return Math.round(Number(match[1]) * (UNITS[match[2]!.toUpperCase()] ?? 0))
}

/**
 * Une `docker ps` y `docker stats` por proyecto de compose. Docker cuenta la CPU por núcleo (200 %
 * son dos núcleos completos); aquí se expresa sobre toda la PC, que es lo que el docente necesita.
 */
export function resourcesFrom(containers: any[], stats: any[], cpus: number): ResourceUsage {
  const statsById = new Map(stats.map((stat) => [stat.ID, stat]))
  const projects: Record<string, ProjectResources> = {}

  for (const container of containers) {
    const project = composeProjectOf(container)
    const stat = statsById.get(container.ID)
    if (!project || !stat) continue
    const cpuPercent = (Number.parseFloat(stat.CPUPerc) || 0) / Math.max(cpus, 1)
    const memoryBytes = parseBytes(String(stat.MemUsage ?? '').split('/')[0] ?? '')
    const entry = projects[project] ??= { cpuPercent: 0, memoryBytes: 0, services: [] }
    entry.cpuPercent += cpuPercent
    entry.memoryBytes += memoryBytes
    entry.services.push({ service: composeServiceOf(container) ?? container.Names, cpuPercent, memoryBytes })
  }

  const limit = String(stats[0]?.MemUsage ?? '').split('/')[1] ?? ''
  return { memoryLimit: parseBytes(limit), projects }
}

let cpuCount: number | undefined

/** Consumo actual de cada proyecto de compose encendido en la PC. Tarda unos 2 s: Docker toma una muestra. */
export async function getResources(): Promise<ResourceUsage> {
  try {
    const containers = parsePs(await docker(['ps', '--format', 'json'], { timeoutMs: STATS_TIMEOUT }))
    if (containers.length === 0) return { memoryLimit: 0, projects: {} }
    cpuCount ??= Number((await docker(['info', '--format', '{{.NCPU}}'], { timeoutMs: STATS_TIMEOUT })).trim()) || 1
    const stats = parsePs(await docker(['stats', '--no-stream', '--format', 'json'], { timeoutMs: STATS_TIMEOUT }))
    return resourcesFrom(containers, stats, cpuCount)
  } catch (err) {
    if (err instanceof CommandError) {
      throw new Error(`No se pudo leer el consumo de los proyectos. Docker respondió: ${err.stderr.split('\n').slice(-2).join(' ')}`)
    }
    throw err
  }
}
