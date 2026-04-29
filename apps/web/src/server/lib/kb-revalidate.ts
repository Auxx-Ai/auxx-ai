// apps/web/src/server/lib/kb-revalidate.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'

const log = createScopedLogger('kb-revalidate')

/**
 * Fire-and-forget POST to apps/kb's revalidate endpoint. Looks up the org
 * handle + KB slug by knowledgeBaseId and invalidates `kb:<orgSlug>/<kbSlug>`.
 *
 * Failures are swallowed: if the public app is offline, the next request
 * after TTL will regenerate. KB_PUBLIC_URL + KB_REVALIDATE_SECRET must be set.
 */
export async function fireKBRevalidate(knowledgeBaseId: string, articleSlugPath?: string) {
  const url = process.env.KB_PUBLIC_URL
  const secret = process.env.KB_REVALIDATE_SECRET
  if (!url || !secret) return

  try {
    const rows = await db
      .select({
        orgHandle: schema.Organization.handle,
        kbSlug: schema.KnowledgeBase.slug,
      })
      .from(schema.KnowledgeBase)
      .innerJoin(
        schema.Organization,
        eq(schema.Organization.id, schema.KnowledgeBase.organizationId)
      )
      .where(eq(schema.KnowledgeBase.id, knowledgeBaseId))
      .limit(1)

    const row = rows[0]
    if (!row || !row.orgHandle || !row.kbSlug) return

    const tags: string[] = [`kb:${row.orgHandle}/${row.kbSlug}`]
    if (articleSlugPath) {
      tags.push(`kb-article:${row.orgHandle}/${row.kbSlug}/${articleSlugPath}`)
    }

    const res = await fetch(`${url}/api/revalidate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ tags }),
    })
    if (!res.ok) {
      log.warn({ status: res.status, knowledgeBaseId }, 'kb revalidate non-2xx')
    }
  } catch (err) {
    log.warn({ err, knowledgeBaseId }, 'kb revalidate failed')
  }
}
