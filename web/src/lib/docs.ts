import type { MarkdownInstance } from 'astro'

/** Orden y descripción de los documentos. El contenido sale de docs/*.md, la única fuente. */
export const DOCS = [
  {
    slug: 'guia-estudiantes',
    title: 'Guía para estudiantes',
    audience: 'Para los equipos',
    summary: 'Cómo debe ir un proyecto: archivos, puertos por equipo, plantillas y prueba antes de entregar.',
  },
  {
    slug: 'manual-usuario',
    title: 'Manual de usuario',
    audience: 'Para el docente',
    summary: 'Cómo meter un proyecto en Dockyard y cómo encenderlo, apagarlo, abrirlo y eliminarlo.',
  },
  {
    slug: 'guia-tecnica',
    title: 'Guía técnica',
    audience: 'Para quien continúe el proyecto',
    summary: 'Arquitectura, despliegue, contrato entre partes, decisiones y pruebas.',
  },
  {
    slug: 'aviso-legal',
    title: 'Aviso legal',
    audience: 'Para todos',
    summary: 'Hasta dónde llega Dockyard, quién responde por cada proyecto, riesgos y licencia.',
  },
  {
    slug: 'privacidad',
    title: 'Privacidad',
    audience: 'Para todos',
    summary: 'Dockyard no recolecta datos: qué se guarda en la PC y cómo borrarlo.',
  },
] as const

const files = import.meta.glob<MarkdownInstance<Record<string, unknown>>>('../../../docs/*.md', { eager: true })

export function docFile(slug: string): MarkdownInstance<Record<string, unknown>> {
  const file = files[`../../../docs/${slug}.md`]
  if (!file) throw new Error(`Falta el documento docs/${slug}.md`)
  return file
}

/**
 * HTML del documento, adaptado a esta sección: los enlaces entre documentos (`manual-usuario.md#algo`)
 * apuntan a su página y cada tabla se desplaza dentro de su propio contenedor, enfocable con el teclado.
 */
export async function docHtml(slug: string): Promise<string> {
  const html = await docFile(slug).compiledContent()
  return html
    .replace(/href="([\w-]+)\.md(#[^"]*)?"/g, (_, name: string, hash = '') => `href="/docs/${name}/${hash}"`)
    .replace(/<table>/g, '<div class="doc-table" tabindex="0" role="region" aria-label="Tabla"><table>')
    .replace(/<\/table>/g, '</table></div>')
}
