// apps/api/src/routes/kb/search.ts

import { Hono } from 'hono'
import { applyChatCorsHeaders } from '../chat/lib'
import { forbidden, loadWidgetKnowledgeBase, notFound } from './lib'
import { searchKb } from './search-index'

const searchRoute = new Hono()

searchRoute.options('/', (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })
  return c.body(null, 204)
})

/**
 * GET /api/kb/search?q=<query>&limit=<n>
 *
 * Searches the KB linked to the caller's widget using a per-KB MiniSearch
 * index cached in-process for 60s. Returns 404 if the widget has no linked
 * KB; 403 if the linked KB is INTERNAL.
 */
searchRoute.get('/', async (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })

  const q = (c.req.query('q') ?? '').trim()
  if (q.length < 2 || q.length > 200) {
    return c.json(
      { success: false, error: { code: 'BAD_REQUEST', message: 'q must be 2–200 characters' } },
      400
    )
  }
  const rawLimit = Number.parseInt(c.req.query('limit') ?? '', 10)
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 25) : 12

  const kb = await loadWidgetKnowledgeBase(c)
  if (!kb) return notFound(c, 'No knowledge base linked to this widget')
  if (kb.visibility !== 'PUBLIC') {
    return forbidden(c, 'This widget is linked to an internal knowledge base.')
  }

  const results = await searchKb(kb.knowledgeBaseId, kb.organizationId, q, limit)
  c.header('Cache-Control', 'no-store')
  return c.json({ success: true, data: { results } })
})

export default searchRoute
