// packages/lib/src/ai/kopilot/capabilities/kb/snapshot-pipeline.ts

import type { Database } from '@auxx/database'
import { getCachedEntityDefId } from '../../../../cache'
import { KBService } from '../../../../kb/kb-service'
import { articleToMarkdown } from '../../../../kb/markdown/article-to-markdown'
import { computeArticleJsonHash } from '../../../../kb/markdown/hash'
import { stampBlockIds } from '../../../../kb/markdown/stamp-ids'
import type {
  AccordionJSON,
  ArticleNodeJSON,
  BlockJSON,
  PanelJSON,
  TableJSON,
  TabsJSON,
} from '../../../../kb/markdown/types'

const TRUNCATION_CHAR_CAP = 32_000

export interface BlockOutlineEntry {
  id: string
  type: string
  level?: number
  preview: string
  containerId?: string
  containerKind?: 'tabs' | 'accordion' | 'panel' | 'tableCell'
  /** For container rows (table/tabs/accordion): row × col for tables, panel count for tabs/accordion. */
  size?: { rows: number; cols: number } | { panels: number }
}

export interface ActiveArticleSnapshot {
  /** `<articleEntityDefinitionId>:<articleId>` — copy verbatim into entity-card fences. */
  recordId: string
  /** Human-readable name for entity-card rendering (title or slug fallback). */
  displayName: string
  /** Secondary line for entity-card rendering (slug). */
  secondaryInfo: string
  articleId: string
  knowledgeBaseId: string
  title: string
  slug: string
  description: string | null
  status: 'DRAFT' | 'PUBLISHED' | 'UNLISTED'
  hasUnpublishedChanges: boolean
  contentHash: string
  bodyMarkdown: string
  bodyTruncated: boolean
  outline: BlockOutlineEntry[]
}

/**
 * Server-side snapshot for the kopilot system prompt. Reads the article's
 * draft revision, stamps any missing block ids in-place (one-shot
 * persistence), computes a hash, and renders both an outline and a
 * markdown body for the agent.
 */
export async function buildActiveArticleSnapshot(args: {
  db: Database
  organizationId: string
  articleId: string
}): Promise<ActiveArticleSnapshot | null> {
  const { db, organizationId, articleId } = args

  const article = await db.query.Article.findFirst({
    where: (a, { and, eq }) => and(eq(a.id, articleId), eq(a.organizationId, organizationId)),
    with: { draftRevision: true },
  })
  if (!article || !article.draftRevision) return null

  // Slug + publish state live on the home placement now.
  const homePlacement = await db.query.ArticlePlacement.findFirst({
    where: (p, { and, eq }) =>
      and(eq(p.articleId, articleId), eq(p.knowledgeBaseId, article.homeKnowledgeBaseId)),
    columns: { slug: true, hasUnpublishedChanges: true },
  })
  const slug = homePlacement?.slug ?? ''
  const hasUnpublishedChanges = homePlacement?.hasUnpublishedChanges ?? false

  const draft = article.draftRevision
  const rawContentJson = (draft.contentJson as ArticleNodeJSON[] | null | undefined) ?? []

  // One-shot id stamping: if the persisted draft has any blocks without
  // ids (a legacy/dev article), persist stamped ids before reasoning.
  // After this, write tools can address blocks by id without a fallback.
  let contentJson = rawContentJson
  if (rawContentJson.length > 0) {
    const { content, changed } = stampBlockIds(rawContentJson)
    if (changed) {
      const kb = new KBService(db, organizationId)
      // Pass through updateArticleDraft so the existing realtime push
      // and snapshot-clear behavior still fire — minor side effect, but
      // it's the same mutation any other writer would use.
      await kb.updateArticleDraft(
        articleId,
        { contentJson: content as unknown as ArticleNodeJSON[] },
        article.authorId ?? draft.editorId ?? organizationId,
        article.homeKnowledgeBaseId
      )
    }
    contentJson = content
  }

  const outline = buildOutline(contentJson)
  const fullMarkdown = articleToMarkdown({ contentJson })
  const { body, truncated } = truncateBody(fullMarkdown, outline)

  const articleEntityDefinitionId = await getCachedEntityDefId(organizationId, 'article')
  const title = draft.title ?? ''
  const displayName = title || slug

  return {
    recordId: articleEntityDefinitionId
      ? `${articleEntityDefinitionId}:${article.id}`
      : `article:${article.id}`,
    displayName,
    secondaryInfo: slug,
    articleId: article.id,
    knowledgeBaseId: article.homeKnowledgeBaseId,
    title,
    slug,
    description: draft.description ?? null,
    status: article.status as 'DRAFT' | 'PUBLISHED' | 'UNLISTED',
    hasUnpublishedChanges,
    contentHash: computeArticleJsonHash(contentJson),
    bodyMarkdown: body,
    bodyTruncated: truncated,
    outline,
  }
}

function buildOutline(content: ArticleNodeJSON[]): BlockOutlineEntry[] {
  const out: BlockOutlineEntry[] = []
  const pushBlock = (
    block: BlockJSON,
    container?: BlockOutlineEntry['containerKind'],
    containerId?: string
  ) => {
    if (!block.attrs.id) return
    out.push({
      id: block.attrs.id,
      type: block.attrs.blockType,
      ...(typeof block.attrs.level === 'number' ? { level: block.attrs.level } : {}),
      preview: extractPreview(block).slice(0, 80),
      ...(container ? { containerKind: container } : {}),
      ...(containerId ? { containerId } : {}),
    })
  }
  const pushPanel = (panel: PanelJSON, kind: 'tabs' | 'accordion', containerId?: string) => {
    if (!panel.attrs.id) return
    out.push({
      id: panel.attrs.id,
      type: 'panel',
      preview: panel.attrs.label?.slice(0, 80) ?? '',
      containerKind: kind,
      ...(containerId ? { containerId } : {}),
    })
    for (const child of panel.content) {
      pushBlock(child, 'panel', panel.attrs.id)
    }
  }
  const pushTabsOrAccordion = (node: TabsJSON | AccordionJSON) => {
    if (!node.attrs.id) return
    const labels = node.content
      .map((p) => p.attrs.label ?? '')
      .filter(Boolean)
      .join(' | ')
    out.push({
      id: node.attrs.id,
      type: node.type,
      preview: `${node.type}: ${labels}`.slice(0, 80),
      size: { panels: node.content.length },
    })
  }
  const pushTable = (node: TableJSON) => {
    if (!node.attrs?.id) return
    const rows = node.content.length
    const cols = node.content[0]?.content.length ?? 0
    const firstCellPreview =
      node.content[0]?.content[0]?.content[0]?.content
        ?.map((n) => (n.type === 'text' ? (n.text ?? '') : ''))
        .join('')
        .trim() ?? ''
    out.push({
      id: node.attrs.id,
      type: 'table',
      preview: `${rows}×${cols} table${firstCellPreview ? `: ${firstCellPreview}` : ''}`.slice(
        0,
        80
      ),
      size: { rows, cols },
    })
  }

  for (const node of content) {
    if (node.type === 'block') {
      pushBlock(node)
      continue
    }
    if (node.type === 'tabs' || node.type === 'accordion') {
      pushTabsOrAccordion(node)
      for (const panel of node.content) pushPanel(panel, node.type, node.attrs.id ?? undefined)
      continue
    }
    if (node.type === 'table') {
      pushTable(node)
      for (const row of node.content) {
        for (const cell of row.content) {
          for (const block of cell.content) pushBlock(block, 'tableCell', node.attrs?.id)
        }
      }
    }
  }
  return out
}

function extractPreview(block: BlockJSON): string {
  if (!block.content || block.content.length === 0) return ''
  return block.content
    .map((n) => (n.type === 'text' ? (n.text ?? '') : ''))
    .join('')
    .trim()
}

function truncateBody(
  markdown: string,
  _outline: BlockOutlineEntry[]
): { body: string; truncated: boolean } {
  if (markdown.length <= TRUNCATION_CHAR_CAP) {
    return { body: markdown, truncated: false }
  }
  // Simple section-aware truncation: keep the first N chars up to the
  // last newline before the cap so headings aren't sliced mid-line, and
  // append a placeholder noting how much was elided. The agent can call
  // `get_article_section` for the rest.
  const slice = markdown.slice(0, TRUNCATION_CHAR_CAP)
  const lastNewline = slice.lastIndexOf('\n')
  const cut = lastNewline > 0 ? slice.slice(0, lastNewline) : slice
  const elidedChars = markdown.length - cut.length
  const body = `${cut}\n\n[… ${elidedChars} chars elided — call \`get_article_section\` for the rest (KB editor only)]`
  return { body, truncated: true }
}
