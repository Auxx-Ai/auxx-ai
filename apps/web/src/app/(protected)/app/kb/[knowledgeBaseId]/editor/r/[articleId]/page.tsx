// apps/web/src/app/(protected)/app/kb/[knowledgeBaseId]/editor/r/[articleId]/page.tsx
//
// Stable-id soft-redirect for the editor. The articles table only has an article's
// id + home KB (slug lives on ArticlePlacement, not the row), so the primary-cell
// click routes here. A *page* (not a route handler) so `router.push` performs a
// soft RSC navigation and the `redirect()` is followed client-side without a full
// reload. Resolves the id to its current slug path and forwards to the editor.

import { ArticlePlacement, database } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '~/auth/session'

interface PageProps {
  params: Promise<{ knowledgeBaseId: string; articleId: string }>
}

export default async function ArticleIdRedirectPage({ params }: PageProps) {
  const { knowledgeBaseId, articleId } = await params

  const session = await getSession()
  if (!session?.user) {
    redirect(`/login?callbackUrl=/app/kb/${knowledgeBaseId}/editor/r/${articleId}`)
  }

  // Resolve the article's placement — prefer the requested KB, else any.
  const placements = await database
    .select({
      id: ArticlePlacement.id,
      knowledgeBaseId: ArticlePlacement.knowledgeBaseId,
      organizationId: ArticlePlacement.organizationId,
    })
    .from(ArticlePlacement)
    .where(eq(ArticlePlacement.articleId, articleId))

  const placement = placements.find((p) => p.knowledgeBaseId === knowledgeBaseId) ?? placements[0]
  if (!placement) notFound()

  const userOrgId = (session.user as { defaultOrganizationId?: string | null })
    .defaultOrganizationId
  if (userOrgId && userOrgId !== placement.organizationId) notFound()

  const slugPath = await buildSlugPath(placement.id, placement.knowledgeBaseId)
  redirect(`/app/kb/${placement.knowledgeBaseId}/editor/~/${slugPath}?panel=articles`)
}

/** Walk the placement tree up from `placementId`, collecting slugs root→leaf. */
async function buildSlugPath(placementId: string, knowledgeBaseId: string): Promise<string> {
  const rows = await database
    .select({
      id: ArticlePlacement.id,
      slug: ArticlePlacement.slug,
      parentId: ArticlePlacement.parentId,
    })
    .from(ArticlePlacement)
    .where(eq(ArticlePlacement.knowledgeBaseId, knowledgeBaseId))

  const byId = new Map(rows.map((r) => [r.id, r]))
  const parts: string[] = []
  const seen = new Set<string>()
  let cursor: string | null = placementId
  while (cursor) {
    if (seen.has(cursor)) break
    seen.add(cursor)
    const row = byId.get(cursor)
    if (!row) break
    parts.unshift(row.slug)
    cursor = row.parentId
  }
  return parts.join('/')
}
