// apps/web/src/app/(protected)/preview/kb/[knowledgeBaseId]/r/[articleId]/route.ts
//
// Stable-id redirect handler for `auxx://kb/article/{id}` links rendered
// inside the admin preview. Resolves the article id to its current slug
// path and 308-redirects to `/preview/kb/{targetKbId}/{slugPath}` — the
// target's *actual* KB id, so cross-KB internal links navigate correctly.

import { ArticlePlacement, database } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '~/auth/server'

interface RouteContext {
  params: Promise<{ knowledgeBaseId: string; articleId: string }>
}

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

  // Resolve the article's placement — prefer the link's source KB, else any.
  const placements = await database
    .select({
      id: ArticlePlacement.id,
      knowledgeBaseId: ArticlePlacement.knowledgeBaseId,
      organizationId: ArticlePlacement.organizationId,
    })
    .from(ArticlePlacement)
    .where(eq(ArticlePlacement.articleId, articleId))

  const row = placements.find((p) => p.knowledgeBaseId === knowledgeBaseId) ?? placements[0]
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Authorize against the *target* article's org. Cross-org leakage would
  // be a problem, but we expect the picker to scope to the active org so
  // this is mostly a sanity check.
  const userOrgId = (session.user as { defaultOrganizationId?: string | null })
    .defaultOrganizationId
  if (userOrgId && userOrgId !== row.organizationId) {
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
