// apps/web/src/app/(protected)/preview/kb/[knowledgeBaseId]/r/[articleId]/route.ts
//
// Stable-id redirect handler for `auxx://kb/article/{id}` links rendered
// inside the admin preview. Resolves the article id to its current slug
// path and 308-redirects to `/preview/kb/{targetKbId}/{slugPath}` — the
// target's *actual* KB id, so cross-KB internal links navigate correctly.

import { ArticlePlacement, database } from '@auxx/database'
import { getCapabilities } from '@auxx/lib/permissions'
import { and, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '~/auth/server'

interface RouteContext {
  params: Promise<{ knowledgeBaseId: string; articleId: string }>
}

/**
 * Authorization, in order — all three of these were holes:
 *
 * 1. **Org.** The placement query carried no `organizationId` filter and the
 *    guard below was `userOrgId && userOrgId !== row.organizationId`, so a
 *    session with no `defaultOrganizationId` skipped it entirely and resolved
 *    ANOTHER org's article id. The read is now org-scoped and the guard is
 *    unconditional: an absent org is a 403, not a pass.
 * 2. **KB instance access.** There was none. The gate keys on the *resolved
 *    target* KB (`row.knowledgeBaseId`), not the URL's — the redirect lands on
 *    the target, which for a cross-KB internal link is a different KB.
 * 3. Everything below stays a 308 to a surface that gates independently.
 *
 * ⚠ Route handlers get no `auxxErrorMiddleware`, so denials are hand-mapped
 * status codes — an `AuxxError` thrown here would surface as a 500.
 */
export async function GET(req: NextRequest, ctx: RouteContext): Promise<Response> {
  const { knowledgeBaseId, articleId } = await ctx.params
  if (!articleId) {
    return NextResponse.json({ error: 'Missing article id' }, { status: 400 })
  }

  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.redirect(
      new URL(`/login?callbackUrl=${encodeURIComponent(req.nextUrl.pathname)}`, req.url)
    )
  }

  const userOrgId = (session.user as { defaultOrganizationId?: string | null })
    .defaultOrganizationId
  if (!userOrgId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Resolve the article's placement — prefer the link's source KB, else any.
  // Org-scoped, so another org's article id is indistinguishable from one that
  // never existed (both → 404).
  const placements = await database
    .select({
      id: ArticlePlacement.id,
      knowledgeBaseId: ArticlePlacement.knowledgeBaseId,
      organizationId: ArticlePlacement.organizationId,
    })
    .from(ArticlePlacement)
    .where(
      and(eq(ArticlePlacement.articleId, articleId), eq(ArticlePlacement.organizationId, userOrgId))
    )

  const row = placements.find((p) => p.knowledgeBaseId === knowledgeBaseId) ?? placements[0]
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Belt-and-braces after the scoped read above.
  if (userOrgId !== row.organizationId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // The redirect discloses the target's slug path, so it needs the same instance
  // gate as the preview it points at (`kb.getArticles` / the `.md` route).
  const capabilities = await getCapabilities(session.user.id, userOrgId)
  if (!capabilities.canViewInstance('kb', row.knowledgeBaseId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const slugPath = await buildSlugPath(row.id, row.knowledgeBaseId)
  return NextResponse.redirect(
    new URL(`/preview/kb/${row.knowledgeBaseId}/${slugPath}`, req.url),
    308
  )
}

/** Walk the placement-tree up from `placementId`, collecting slugs. */
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
