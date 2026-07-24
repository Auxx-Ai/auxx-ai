// packages/lib/src/kb/catalog/render-kb-catalog.ts

// Direct relative path, not the `agents` barrel — avoids pulling the agents
// module graph into every consumer of this file (packages/lib import-cycle
// hygiene).
import type { ResolvedKnowledgeScope } from '../../agents/resolve-knowledge-scope'
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
  /**
   * Per-instance read gate for the member audience (capability layer v2 §3.4).
   * Applied on top of {@link RenderKbCatalogOptions.publicOnly}: a KB the
   * principal can't VIEW is dropped entirely, so its article titles and
   * body-derived descriptions never reach the model. Omit ⇒ no gating (today's
   * output) — the workflow AI node and any un-threaded caller.
   */
  canViewKb?: (kbId: string) => boolean
  /**
   * Agent retrieval scope (permissions v2 §1.2/1.3) — the same allowlist
   * `search_knowledge` enforces (`isSegmentInKnowledgeScope` in
   * search-knowledge.ts). Composes with {@link publicOnly} and
   * {@link canViewKb}, it does not replace either: a KB/article can pass both
   * of those and still be dropped or trimmed here. `null`/`undefined` ⇒ no
   * scope narrowing (today's output) — the org-wide default.
   */
  knowledgeScope?: ResolvedKnowledgeScope | null
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
  const {
    publicOnly,
    maxChars = DEFAULT_MAX_CHARS,
    hasGetArticle = true,
    canViewKb,
    knowledgeScope,
  } = options

  const kbs = catalog
    .map((kb) => narrowKbByScope(kb, knowledgeScope))
    .filter((kb): kb is KbCatalogEntry => kb !== null)
    .filter(
      (kb) =>
        kb.articles.length > 0 &&
        (!publicOnly || kb.visibility === 'PUBLIC') &&
        (!canViewKb || canViewKb(kb.id))
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

/**
 * Narrow one catalog KB to the agent retrieval scope (permissions v2
 * §1.2/1.3). Pure and DB-free — `scope` is already fully resolved by
 * `resolveAgentKnowledgeScope`, so this is plain set membership, not a
 * re-derivation of KB/article inclusion.
 *
 * - `null`/`undefined` scope ⇒ no-op, returns `kb` unchanged.
 * - Whole-KB kept as-is if `kb.id` is in `fullKbIds`, OR at least one of its
 *   own articles is in `articleIds` (a partially-included KB). Otherwise the
 *   KB is dropped entirely (returns `null`).
 * - Within a kept, non-full KB, only articles in `articleIds` survive.
 * - In any kept KB (full or partial), articles in `excludedArticleIds` are
 *   always dropped — an excluded article never renders even inside an
 *   otherwise fully-included KB. A full KB whose every article ends up
 *   excluded is left with an empty `articles` array; the caller's existing
 *   `articles.length > 0` filter drops it same as any other empty KB.
 */
function narrowKbByScope(
  kb: KbCatalogEntry,
  scope: ResolvedKnowledgeScope | null | undefined
): KbCatalogEntry | null {
  if (!scope) return kb
  const isFullKb = scope.fullKbIds.has(kb.id)
  const kept = isFullKb || kb.articles.some((a) => scope.articleIds.has(a.id))
  if (!kept) return null
  const articles = kb.articles.filter(
    (a) => !scope.excludedArticleIds.has(a.id) && (isFullKb || scope.articleIds.has(a.id))
  )
  return articles.length === kb.articles.length ? kb : { ...kb, articles }
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
