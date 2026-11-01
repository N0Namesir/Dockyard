// Genera en ejemplos/zips/ las variantes de ZIP con las que se prueba prepareProject:
//
//   node ejemplos/crear-zips.ts
//
//   prueba-estatico.zip             el compose en la raíz
//   prueba-estatico-intermedia.zip  el compose dentro de una carpeta intermedia
//   sin-compose.zip                 sin archivo compose (debe fallar sin dejar carpetas a medias)
//   danado.zip                      un archivo que no es un ZIP válido
//
// No depende del comando zip: escribe el formato a mano con node:zlib.

import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { crc32, deflateRawSync } from 'node:zlib'

interface Entry {
  name: string
  data: Buffer
}

/** Arma un ZIP (método deflate) con las entradas dadas. */
export function buildZip(entries: Entry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8')
    const compressed = deflateRawSync(data)
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // versión necesaria
    local.writeUInt16LE(0x0800, 6) // nombres en UTF-8
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt32LE(0x0021 << 16, 10) // hora 00:00, fecha 1980-01-01
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, nameBuf, compressed)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE((3 << 8) | 20, 4) // hecho en Unix, versión 2.0
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(0x0021 << 16, 12)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38) // permisos rw-r--r--
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)

    offset += local.length + nameBuf.length + compressed.length
  }

  const centralDir = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDir.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralDir, end])
}

/** Lee todos los archivos de una carpeta, con rutas relativas y un prefijo opcional. */
export async function entriesFrom(dir: string, prefix = ''): Promise<Entry[]> {
  const files = await readdir(dir, { recursive: true, withFileTypes: true })
  return Promise.all(
    files
      .filter((f) => f.isFile())
      .map(async (f) => {
        const full = join(f.parentPath, f.name)
        return { name: prefix + relative(dir, full), data: await readFile(full) }
      }),
  )
}

/** Crea las variantes de prueba en la carpeta indicada y devuelve sus rutas. */
export async function createTestZips(outDir: string) {
  const estatico = join(import.meta.dirname, 'prueba-estatico')
  await mkdir(outDir, { recursive: true })

  const paths = {
    raiz: join(outDir, 'prueba-estatico.zip'),
    intermedia: join(outDir, 'prueba-estatico-intermedia.zip'),
    sinCompose: join(outDir, 'sin-compose.zip'),
    danado: join(outDir, 'danado.zip'),
  }
  await writeFile(paths.raiz, buildZip(await entriesFrom(estatico)))
  await writeFile(paths.intermedia, buildZip(await entriesFrom(estatico, 'prueba-estatico/')))
  await writeFile(paths.sinCompose, buildZip(await entriesFrom(join(estatico, 'html'))))
  await writeFile(paths.danado, Buffer.from('esto no es un zip'))
  return paths
}

if (import.meta.main) {
  const paths = await createTestZips(join(import.meta.dirname, 'zips'))
  for (const path of Object.values(paths)) console.log(path)
}
