// apps/api/src/routes/kb/articles.ts

import { KB_URL } from '@auxx/config/server'
import { database, schema } from '@auxx/database'
import { renderArticleHtml } from '@auxx/lib/kb'
import type { ArticleNodeJSON } from '@auxx/lib/kb/markdown'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { applyChatCorsHeaders } from '../chat/lib'
import { forbidden, loadWidgetKnowledgeBase, notFound } from './lib'

const articlesRoute = new Hono()

articlesRoute.options('/:id', (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })
  return c.body(null, 204)
})

/**
 * GET /api/kb/articles/:id
 *
 * Renders the requested article to a sanitized HTML string for the widget.
 * The article must belong to the widget's linked KB; cross-widget access by
 * id returns 404. Cached for 60s.
 */
articlesRoute.get('/:id', async (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })
  const kb = await loadWidgetKnowledgeBase(c)
  if (!kb) return notFound(c, 'No knowledge base linked to this widget')
  if (kb.visibility !== 'PUBLIC') {
    return forbidden(c, 'This widget is linked to an internal knowledge base.')
  }

  const articleId = c.req.param('id')
  const article = await database.query.Article.findFirst({
    where: and(
      eq(schema.Article.id, articleId),
      eq(schema.Article.knowledgeBaseId, kb.knowledgeBaseId),
      eq(schema.Article.organizationId, kb.organizationId),
      eq(schema.Article.isPublished, true)
    ),
    with: { publishedRevision: true },
  })
  if (!article || !article.publishedRevision) {
    return notFound(c, 'Article not found')
  }

  const rev = article.publishedRevision
  const contentJson = (rev.contentJson ?? []) as
    | ArticleNodeJSON[]
    | { type: 'doc'; content: ArticleNodeJSON[] }

  const publicArticleUrl = `${KB_URL}/r/${article.id}`
  const html = renderArticleHtml(contentJson, {
    coverImageUrl: rev.coverImage,
    title: rev.title,
    emoji: rev.emoji,
    publicArticleUrl,
  })

  c.header('Cache-Control', 'public, max-age=60')
  return c.json({
    success: true,
    data: {
      id: article.id,
      title: rev.title,
      emoji: rev.emoji ?? undefined,
      coverImageUrl: rev.coverImage ?? undefined,
      html,
      updatedAt: rev.updatedAt,
    },
  })
})

export default articlesRoute
