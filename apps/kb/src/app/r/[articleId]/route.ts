// apps/kb/src/app/r/[articleId]/route.ts
//
// Stable-id redirect handler for internal `auxx://kb/article/{id}` links.
// The renderer emits `<a href="/r/{id}">` so links survive renames; this
// route resolves the id to the canonical `/orgSlug/kbSlug/slug-path` URL
// at click time and 308-redirects.

import { Article, database, KnowledgeBase, Organization } from '@auxx/database'
import { isOrgMember } from '@auxx/lib/cache'
import { and, eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { type NextRequest, NextResponse } from 'next/server'
import { getLocalSession, getLoginUrl } from '~/lib/auth'

interface RouteContext {
  params: Promise<{ articleId: string }>
}

export async function GET(_req: NextRequest, ctx: RouteContext): Promise<Response> {
  const { articleId } = await ctx.params
  if (!articleId) return NextResponse.json({ error: 'Missing article id' }, { status: 400 })

  const [row] = await database
    .select({
      id: Article.id,
      slug: Article.slug,
      parentId: Article.parentId,
      isPublished: Article.isPublished,
      knowledgeBaseId: Article.knowledgeBaseId,
      organizationId: Article.organizationId,
      kbSlug: KnowledgeBase.slug,
      kbVisibility: KnowledgeBase.visibility,
      kbPublishStatus: KnowledgeBase.publishStatus,
      orgSlug: Organization.handle,
    })
    .from(Article)
    .innerJoin(KnowledgeBase, eq(KnowledgeBase.id, Article.knowledgeBaseId))
    .innerJoin(Organization, eq(Organization.id, KnowledgeBase.organizationId))
    .where(eq(Article.id, articleId))
    .limit(1)

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (row.kbPublishStatus === 'DRAFT' || !row.isPublished) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (row.kbVisibility === 'INTERNAL') {
    const session = await getLocalSession()
    if (!session) {
      const slugPath = await buildSlugPath(row.id, row.knowledgeBaseId)
      redirect(getLoginUrl(row.knowledgeBaseId, `/${row.orgSlug}/${row.kbSlug}/${slugPath}`))
    }
    const member = await isOrgMember(row.organizationId, session.userId)
    if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const slugPath = await buildSlugPath(row.id, row.knowledgeBaseId)
  return NextResponse.redirect(new URL(`/${row.orgSlug}/${row.kbSlug}/${slugPath}`, _req.url), 308)
}

/**
 * Walk parent chain to assemble the article's full slug path. Tiny lookup
 * (depth ~3-5) — fine to do per redirect.
 */
async function buildSlugPath(articleId: string, knowledgeBaseId: string): Promise<string> {
  const rows = await database
    .select({
      id: Article.id,
      slug: Article.slug,
      parentId: Article.parentId,
    })
    .from(Article)
    .where(and(eq(Article.knowledgeBaseId, knowledgeBaseId), eq(Article.isPublished, true)))

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
