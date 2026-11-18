import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { HttpError } from '../errors.ts'

/** Una foto de pantalla o un logo caben de sobra; más que esto haría lenta la lista. */
export const IMAGE_MAX_BYTES = 2 * 1024 * 1024

const CONTENT_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as const
type ImageType = keyof typeof CONTENT_TYPES

/**
 * Tipo de imagen según sus primeros bytes, no según el nombre ni lo que diga el navegador. Solo
 * PNG, JPEG y WebP: un SVG puede llevar scripts y se serviría desde el mismo origen que la API.
 */
export function imageTypeOf(bytes: Uint8Array): ImageType | null {
  const starts = (signature: number[], offset = 0) => signature.every((byte, i) => bytes[offset + i] === byte)
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (starts([0xff, 0xd8, 0xff])) return 'jpg'
  // RIFF....WEBP
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'webp'
  return null
}

/** Nombre de archivo que guarda la base: siempre `<id>.<tipo>`, nunca algo que venga del navegador. */
const FILE_PATTERN = /^(\d+)\.(png|jpg|webp)$/

/** Imágenes de los proyectos, en data/imagenes/<id>.<tipo>, junto a la base. */
export function createImageStore(dir: string) {
  async function remove(id: number): Promise<void> {
    await Promise.all(Object.keys(CONTENT_TYPES).map((type) => rm(join(dir, `${id}.${type}`), { force: true })))
  }

  return {
    /** Guarda la imagen del proyecto, reemplazando la anterior, y devuelve el nombre de su archivo. */
    async save(id: number, bytes: Uint8Array): Promise<string> {
      const type = imageTypeOf(bytes)
      if (!type) throw new HttpError(400, 'La imagen debe ser PNG, JPEG o WebP.')
      await mkdir(dir, { recursive: true })
      await remove(id)
      const file = `${id}.${type}`
      await writeFile(join(dir, file), bytes)
      return file
    },

    async read(file: string): Promise<{ bytes: Buffer; contentType: string }> {
      const match = FILE_PATTERN.exec(file)
      if (!match) throw new HttpError(404, 'El proyecto no tiene imagen.')
      try {
        return { bytes: await readFile(join(dir, file)), contentType: CONTENT_TYPES[match[2] as ImageType] }
      } catch {
        throw new HttpError(404, 'El proyecto no tiene imagen.')
      }
    },

    remove,
  }
}

export type ImageStore = ReturnType<typeof createImageStore>
