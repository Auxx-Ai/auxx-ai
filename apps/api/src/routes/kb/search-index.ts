// apps/api/src/routes/kb/search-index.ts
//
// Per-KB in-memory MiniSearch index for the chat widget Help-tab search.
// Index docs are { id, title, headings, body } extracted from each published
// article. We rebuild on demand and cache for INDEX_TTL_MS so steady-state
// queries are pure CPU.

import { database, schema } from '@auxx/database'
import type { ArticleNodeJSON } from '@auxx/lib/kb/markdown'
import { extractHeadings, extractPlainText } from '@auxx/lib/kb/markdown'
import { and, eq, isNull } from 'drizzle-orm'
import MiniSearch from 'minisearch'

const INDEX_TTL_MS = 60_000
const MAX_BODY = 4000

interface IndexedArticle {
  id: string
  title: string
  emoji: string | null
  articleKind: 'page' | 'category' | 'header' | 'tab' | 'link'
  headings: string
  body: string
}

interface CachedIndex {
  index: MiniSearch<IndexedArticle>
  meta: Map<
    string,
    { title: string; emoji: string | null; articleKind: IndexedArticle['articleKind'] }
  >
  builtAt: number
}

const cache = new Map<string, CachedIndex>()
const inflight = new Map<string, Promise<CachedIndex>>()

export interface KbSearchHit {
  id: string
  title: string
  emoji?: string
  articleKind: IndexedArticle['articleKind']
}

export async function searchKb(
  knowledgeBaseId: string,
  organizationId: string,
  query: string,
  limit: number
): Promise<KbSearchHit[]> {
  const cached = await getOrBuildIndex(knowledgeBaseId, organizationId)
  const hits = cached.index.search(query, {
    boost: { title: 3, headings: 2 },
    fuzzy: 0.2,
    prefix: true,
  })
  const results: KbSearchHit[] = []
  for (const hit of hits.slice(0, limit)) {
    const meta = cached.meta.get(hit.id as string)
    if (!meta) continue
    results.push({
      id: hit.id as string,
      title: meta.title,
      emoji: meta.emoji ?? undefined,
      articleKind: meta.articleKind,
    })
  }
  return results
}

async function getOrBuildIndex(
  knowledgeBaseId: string,
  organizationId: string
): Promise<CachedIndex> {
  const existing = cache.get(knowledgeBaseId)
  if (existing && Date.now() - existing.builtAt < INDEX_TTL_MS) return existing

  const pending = inflight.get(knowledgeBaseId)
  if (pending) return pending

  const promise = buildIndex(knowledgeBaseId, organizationId)
    .then((next) => {
      cache.set(knowledgeBaseId, next)
      return next
    })
    .finally(() => {
      inflight.delete(knowledgeBaseId)
    })
  inflight.set(knowledgeBaseId, promise)
  return promise
}

async function buildIndex(knowledgeBaseId: string, organizationId: string): Promise<CachedIndex> {
  const rows = await database
    .select({
      id: schema.ArticlePlacement.articleId,
      title: schema.Article.title,
      emoji: schema.Article.emoji,
      articleKind: schema.Article.articleKind,
      publishedRevisionId: schema.ArticlePlacement.publishedRevisionId,
    })
    .from(schema.ArticlePlacement)
    .innerJoin(schema.Article, eq(schema.Article.id, schema.ArticlePlacement.articleId))
    .where(
      and(
        eq(schema.ArticlePlacement.knowledgeBaseId, knowledgeBaseId),
        eq(schema.ArticlePlacement.organizationId, organizationId),
        eq(schema.ArticlePlacement.isPublished, true),
        isNull(schema.Article.archivedAt)
      )
    )

  const indexable = rows.filter(
    (r) => r.articleKind !== 'tab' && r.articleKind !== 'header' && r.articleKind !== 'link'
  )
  const revisionIds = indexable
    .map((r) => r.publishedRevisionId)
    .filter((id): id is string => typeof id === 'string')

  const revisions = revisionIds.length
    ? await database.query.ArticleRevision.findMany({
        where: (rev, { inArray }) => inArray(rev.id, revisionIds),
        columns: { id: true, contentJson: true },
      })
    : []
  const revisionMap = new Map(revisions.map((r) => [r.id, r.contentJson]))

  const docs: IndexedArticle[] = []
  const meta = new Map<string, CachedIndex['meta'] extends Map<string, infer V> ? V : never>()
  for (const row of indexable) {
    const raw = row.publishedRevisionId ? revisionMap.get(row.publishedRevisionId) : null
    const contentJson = normalizeContent(raw)
    const title = row.title ?? 'Untitled'
    const articleKind = row.articleKind as IndexedArticle['articleKind']
    docs.push({
      id: row.id,
      title,
      emoji: row.emoji ?? null,
      articleKind,
      headings: extractHeadings(contentJson).join(' '),
      body: extractPlainText(contentJson).slice(0, MAX_BODY),
    })
    meta.set(row.id, { title, emoji: row.emoji ?? null, articleKind })
  }

  const index = new MiniSearch<IndexedArticle>({
    fields: ['title', 'headings', 'body'],
    storeFields: ['id'],
    idField: 'id',
  })
  index.addAll(docs)

  return { index, meta, builtAt: Date.now() }
}

function normalizeContent(raw: unknown): ArticleNodeJSON[] | null {
  if (!raw) return null
  if (Array.isArray(raw)) return raw as ArticleNodeJSON[]
  if (typeof raw === 'object' && raw && 'content' in raw) {
    const content = (raw as { content: unknown }).content
    if (Array.isArray(content)) return content as ArticleNodeJSON[]
  }
  return null
}

/** Test-only: drop the in-memory cache so the next request rebuilds. */
export function __resetKbSearchIndexCache(): void {
  cache.clear()
  inflight.clear()
}
