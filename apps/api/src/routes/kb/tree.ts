// apps/api/src/routes/kb/tree.ts

import { database, schema } from '@auxx/database'
import { and, asc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { applyChatCorsHeaders } from '../chat/lib'
import { forbidden, loadWidgetKnowledgeBase, notFound } from './lib'

const treeRoute = new Hono()

treeRoute.options('/', (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })
  return c.body(null, 204)
})

/**
 * GET /api/kb/tree
 *
 * Metadata-only article tree for the KB linked to the caller's widget.
 * Cached for 60s so first-paint in the widget is instant. Returns 404 if
 * the widget has no linked KB; 403 if the linked KB is INTERNAL (v1 only
 * supports PUBLIC KBs in the widget).
 */
treeRoute.get('/', async (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })
  const kb = await loadWidgetKnowledgeBase(c)
  if (!kb) return notFound(c, 'No knowledge base linked to this widget')
  if (kb.visibility !== 'PUBLIC') {
    return forbidden(c, 'This widget is linked to an internal knowledge base.')
  }

  const rows = await database
    .select({
      id: schema.Article.id,
      parentId: schema.Article.parentId,
      title: schema.Article.title,
      emoji: schema.Article.emoji,
      articleKind: schema.Article.articleKind,
      sortOrder: schema.Article.sortOrder,
    })
    .from(schema.Article)
    .where(
      and(
        eq(schema.Article.knowledgeBaseId, kb.knowledgeBaseId),
        eq(schema.Article.organizationId, kb.organizationId),
        eq(schema.Article.isPublished, true)
      )
    )
    .orderBy(asc(schema.Article.parentId), asc(schema.Article.sortOrder))

  c.header('Cache-Control', 'public, max-age=60')
  return c.json({
    success: true,
    data: {
      site: {
        name: kb.name,
        description: kb.description ?? undefined,
        logoUrl: kb.logoUrl ?? undefined,
      },
      nodes: rows.map((r) => ({
        id: r.id,
        parentId: r.parentId,
        title: r.title ?? 'Untitled',
        emoji: r.emoji ?? undefined,
        articleKind: r.articleKind,
        sortOrder: r.sortOrder,
      })),
    },
  })
})

export default treeRoute
