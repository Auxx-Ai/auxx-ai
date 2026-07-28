// apps/kb/src/app/r/[articleId]/route.ts
//
// Stable-id redirect handler for internal `auxx://kb/article/{id}` links.
// The renderer emits `<a href="/r/{id}">` so links survive renames; this
// route resolves the id to the canonical `/orgSlug/kbSlug/slug-path` URL
// at click time and 308-redirects.

import { ArticlePlacement, database, KnowledgeBase, Organization } from '@auxx/database'
import { and, desc, eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { type NextRequest, NextResponse } from 'next/server'
import { getLocalSession, getLoginUrl } from '~/lib/auth'
import { canViewKB } from '~/server/kb-access'

interface RouteContext {
  params: Promise<{ articleId: string }>
}

export async function GET(_req: NextRequest, ctx: RouteContext): Promise<Response> {
  const { articleId } = await ctx.params
  if (!articleId) return NextResponse.json({ error: 'Missing article id' }, { status: 400 })

  const [row] = await database
    .select({
      id: ArticlePlacement.id,
      slug: ArticlePlacement.slug,
      parentId: ArticlePlacement.parentId,
      isPublished: ArticlePlacement.isPublished,
      knowledgeBaseId: ArticlePlacement.knowledgeBaseId,
      organizationId: ArticlePlacement.organizationId,
      kbSlug: KnowledgeBase.slug,
      kbVisibility: KnowledgeBase.visibility,
      kbPublishStatus: KnowledgeBase.publishStatus,
      orgSlug: Organization.handle,
    })
    .from(ArticlePlacement)
    .innerJoin(KnowledgeBase, eq(KnowledgeBase.id, ArticlePlacement.knowledgeBaseId))
    .innerJoin(Organization, eq(Organization.id, KnowledgeBase.organizationId))
    .where(eq(ArticlePlacement.articleId, articleId))
    // Prefer a published placement when the article is multi-homed.
    .orderBy(desc(ArticlePlacement.isPublished))
    .limit(1)

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (row.kbPublishStatus === 'DRAFT' || !row.isPublished) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (row.kbVisibility === 'INTERNAL') {
    const session = await getLocalSession()
    if (!session) {
      // Return to THIS route, not the canonical article URL: resolving the
      // slug path here would run pre-auth and leak the org handle, KB slug and
      // title-derived path into a redirect an unauthenticated caller holding
      // only an article id can trigger. `/r/<id>` re-resolves after login and
      // preserves the deep link.
      redirect(getLoginUrl(row.knowledgeBaseId, `/r/${articleId}`))
    }
    if (!(await canViewKB(row.knowledgeBaseId, row.organizationId, session.userId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const slugPath = await buildSlugPath(row.id, row.knowledgeBaseId)
  return NextResponse.redirect(new URL(`/${row.orgSlug}/${row.kbSlug}/${slugPath}`, _req.url), 308)
}

/**
 * Walk parent chain to assemble the article's full slug path. Tiny lookup
 * (depth ~3-5) — fine to do per redirect.
 */
async function buildSlugPath(placementId: string, knowledgeBaseId: string): Promise<string> {
  const rows = await database
    .select({
      id: ArticlePlacement.id,
      slug: ArticlePlacement.slug,
      parentId: ArticlePlacement.parentId,
    })
    .from(ArticlePlacement)
    .where(
      and(
        eq(ArticlePlacement.knowledgeBaseId, knowledgeBaseId),
        eq(ArticlePlacement.isPublished, true)
      )
    )

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
