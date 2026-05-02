// apps/web/src/app/(protected)/preview/kb/[knowledgeBaseId]/r/[articleId]/route.ts
//
// Stable-id redirect handler for `auxx://kb/article/{id}` links rendered
// inside the admin preview. Resolves the article id to its current slug
// path and 308-redirects to `/preview/kb/{targetKbId}/{slugPath}` — the
// target's *actual* KB id, so cross-KB internal links navigate correctly.

import { Article, database, KnowledgeBase } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '~/auth/server'

interface RouteContext {
  params: Promise<{ knowledgeBaseId: string; articleId: string }>
}

export async function GET(req: NextRequest, ctx: RouteContext): Promise<Response> {
  const { articleId } = await ctx.params
  if (!articleId) {
    return NextResponse.json({ error: 'Missing article id' }, { status: 400 })
  }

  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.redirect(
      new URL(`/login?callbackUrl=${encodeURIComponent(req.nextUrl.pathname)}`, req.url)
    )
  }

  const [row] = await database
    .select({
      id: Article.id,
      knowledgeBaseId: Article.knowledgeBaseId,
      organizationId: Article.organizationId,
    })
    .from(Article)
    .innerJoin(KnowledgeBase, eq(KnowledgeBase.id, Article.knowledgeBaseId))
    .where(eq(Article.id, articleId))
    .limit(1)

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Authorize against the *target* article's org. Cross-org leakage would
  // be a problem, but we expect the picker to scope to the active org so
  // this is mostly a sanity check.
  const activeOrgId = (session.session as { activeOrganizationId?: string }).activeOrganizationId
  if (activeOrgId && activeOrgId !== row.organizationId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const slugPath = await buildSlugPath(row.id, row.knowledgeBaseId)
  return NextResponse.redirect(
    new URL(`/preview/kb/${row.knowledgeBaseId}/${slugPath}`, req.url),
    308
  )
}

async function buildSlugPath(articleId: string, knowledgeBaseId: string): Promise<string> {
  const rows = await database
    .select({
      id: Article.id,
      slug: Article.slug,
      parentId: Article.parentId,
    })
    .from(Article)
    .where(eq(Article.knowledgeBaseId, knowledgeBaseId))

  const byId = new Map(rows.map((r) => [r.id, r]))
  const parts: string[] = []
  const seen = new Set<string>()
  let cursor: string | null = articleId
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
