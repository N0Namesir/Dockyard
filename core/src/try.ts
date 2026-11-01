// Prueba manual del núcleo, sin la API. Ejecuta en orden:
// prepareProject, getProjectStatus, startProject, getProjectStatus, stopProject y getProjectStatus.
//
//   npm run try -w core -- <url-https | archivo.zip | carpeta> [nombre]
//
// Con una carpeta se omite prepareProject y se usa tal cual (útil para los proyectos de ejemplos/).

import { stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { getProjectStatus, normalizeProjectName, prepareProject, startProject, stopProject } from './index.ts'
import type { ProjectSource } from './types.ts'

const [input, nameArg] = process.argv.slice(2)
if (!input) {
  console.error('Uso: npm run try -w core -- <url-https | archivo.zip | carpeta> [nombre]')
  process.exit(1)
}

async function step<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const started = Date.now()
  try {
    const result = await fn()
    console.log(`✔ ${label} (${Date.now() - started} ms)`, result)
    return result
  } catch (err) {
    console.error(`✘ ${label} (${Date.now() - started} ms)\n${(err as Error).message}`)
    process.exit(1)
  }
}

const isUrl = /^https?:\/\//.test(input)
const isDir = !isUrl && (await stat(input).catch(() => null))?.isDirectory()
const name = normalizeProjectName(nameArg ?? basename(input).replace(/\.(zip|git)$/, ''))

let dir: string
if (isDir) {
  dir = resolve(input)
  console.log(`Carpeta ${dir}, proyecto ${name}`)
} else {
  const source: ProjectSource = isUrl ? { type: 'git', url: input } : { type: 'zip', filePath: resolve(input) }
  dir = (await step('prepareProject', () => prepareProject(source, name))).dir
}

await step('getProjectStatus', () => getProjectStatus(name))
await step('startProject', () => startProject(dir, name))
await step('getProjectStatus', () => getProjectStatus(name))
await step('stopProject', () => stopProject(dir, name))
await step('getProjectStatus', () => getProjectStatus(name))
