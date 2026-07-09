// packages/lib/src/kb/catalog/render-kb-catalog.ts

import type { KbCatalogEntry } from './kb-catalog'

export interface RenderKbCatalogOptions {
  /** Customer-facing run — only PUBLIC KBs may appear. */
  publicOnly: boolean
  /**
   * Size cap for the rendered catalog (~2k tokens by default). Over the cap
   * the render degrades to KB names + article counts — that org is exactly
   * the large-corpus case embedding search is kept for.
   */
  maxChars?: number
  /** Whether the run has `get_article` — drives the "how to read one" line. */
  hasGetArticle?: boolean
}

const DEFAULT_MAX_CHARS = 8_000
const DESCRIPTION_MAX = 160

/**
 * Render the cached KB catalog as a prompt section (`## Knowledge Catalog`).
 * Returns null when nothing survives filtering (no KBs / no articles), so
 * callers can drop the section entirely.
 */
export function renderKbCatalog(
  catalog: readonly KbCatalogEntry[],
  options: RenderKbCatalogOptions
): string | null {
  const { publicOnly, maxChars = DEFAULT_MAX_CHARS, hasGetArticle = true } = options

  const kbs = catalog.filter(
    (kb) => kb.articles.length > 0 && (!publicOnly || kb.visibility === 'PUBLIC')
  )
  if (kbs.length === 0) return null

  const readHint = hasGetArticle
    ? 'Read any article with `get_article` (pass the id in brackets).'
    : 'Search for their content with `search_knowledge`.'
  const header =
    '## Knowledge Catalog\n' +
    `Published knowledge-base articles available to you. ${readHint} ` +
    'Browse this catalog first when the user needs org knowledge (policies, product facts, how-tos); ' +
    'use `search_knowledge` when nothing here covers the question or to search uploaded documents.'

  const full = [header, ...kbs.map(renderKb)].join('\n\n')
  if (full.length <= maxChars) return full

  // Degraded render: names + counts only. The model leans on search instead.
  const compact = [
    '## Knowledge Catalog\n' +
      'This org has too many articles to list individually. Knowledge bases ' +
      '(use `search_knowledge` to find content, `list_articles` to browse one):',
    ...kbs.map(
      (kb) =>
        `- **${kb.name}** — ${kb.articles.length} article${kb.articles.length === 1 ? '' : 's'}` +
        (kb.description ? ` — ${truncate(kb.description, DESCRIPTION_MAX)}` : '')
    ),
  ].join('\n')
  return compact
}

function renderKb(kb: KbCatalogEntry): string {
  const lines = kb.articles.map((a) => {
    const indent = '  '.repeat(a.depth)
    const description = a.description ? ` — ${truncate(a.description, DESCRIPTION_MAX)}` : ''
    return `${indent}- ${a.title}${description} [${a.id}]`
  })
  return `### ${kb.name}\n${lines.join('\n')}`
}

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`
}
