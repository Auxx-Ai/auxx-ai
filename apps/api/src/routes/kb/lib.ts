// apps/api/src/routes/kb/lib.ts

import { database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { applyChatCorsHeaders } from '../chat/lib'

export interface ResolvedWidgetKb {
  organizationId: string
  knowledgeBaseId: string
  name: string
  slug: string
  description: string | null
  logoUrl: string | null
  visibility: 'PUBLIC' | 'INTERNAL'
}

/**
 * Load the KB linked to the widget identified by the verified chat passport
 * on `c.var.chat`. Returns `null` when the widget has no linkage or the KB
 * has been deleted. Visibility is returned so the caller can short-circuit
 * INTERNAL KBs with a friendly error.
 */
export async function loadWidgetKnowledgeBase(c: Context): Promise<ResolvedWidgetKb | null> {
  const chat = c.get('chat')
  const widget = await database.query.ChatWidget.findFirst({
    where: (w, { eq: e }) => e(w.integrationId, chat.channelId),
    columns: { knowledgeBaseId: true, organizationId: true },
  })
  if (!widget?.knowledgeBaseId) return null

  const kb = await database.query.KnowledgeBase.findFirst({
    where: and(
      eq(schema.KnowledgeBase.id, widget.knowledgeBaseId),
      eq(schema.KnowledgeBase.organizationId, widget.organizationId)
    ),
    columns: {
      id: true,
      name: true,
      slug: true,
      description: true,
      logoLight: true,
      logoDark: true,
      visibility: true,
    },
  })
  if (!kb) return null

  return {
    organizationId: widget.organizationId,
    knowledgeBaseId: kb.id,
    name: kb.name,
    slug: kb.slug,
    description: kb.description ?? null,
    logoUrl: kb.logoLight ?? kb.logoDark ?? null,
    visibility: kb.visibility as 'PUBLIC' | 'INTERNAL',
  }
}

export function notFound(c: Context, message: string) {
  applyChatCorsHeaders(c, { allowCredentials: true })
  return c.json({ success: false, error: { code: 'NOT_FOUND', message } }, 404)
}

export function forbidden(c: Context, message: string) {
  applyChatCorsHeaders(c, { allowCredentials: true })
  return c.json({ success: false, error: { code: 'FORBIDDEN', message } }, 403)
}
