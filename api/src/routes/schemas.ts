// Esquemas de TypeBox que comparten las rutas de proyectos y de respaldo.
import { Type } from '@sinclair/typebox'
import { DISPLAY_NAME_MAX_LENGTH } from '../services/projects.ts'

export const YEAR = { minimum: 2000, maximum: 2100 }
export const displayNameSchema = Type.String({ minLength: 1, maxLength: DISPLAY_NAME_MAX_LENGTH })
export const yearSchema = Type.Integer(YEAR)

export const contactSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 80 }),
    // Un correo simple, algo@algo.algo, o nada: un campo vacío no se guarda. La interfaz lo convierte en mailto:.
    email: Type.Optional(Type.String({ maxLength: 254, pattern: '^\\s*([^\\s@]+@[^\\s@]+\\.[^\\s@]+)?\\s*$' })),
    phone: Type.Optional(Type.String({ maxLength: 30 })),
  },
  { additionalProperties: false },
)

export const NOTES_MAX_LENGTH = 2000
export const DESCRIPTION_MAX_LENGTH = 2000
export const INSTRUCTIONS_MAX_LENGTH = 4000
export const CONTACTS_MAX = 8
