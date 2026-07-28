// apps/kb/src/app/[orgSlug]/[kbSlug]/search.json/route.ts

import { buildKBSearchIndex, getArticleSlugPaths } from '@auxx/ui/components/kb'
import { cacheLife, cacheTag } from 'next/cache'
import { getLocalSession } from '~/lib/auth'
import { canViewKB } from '../../../../server/kb-access'
import { getPublicKBPayloadWithContent, kbTag } from '../../../../server/kb-cache'
import { getKBVisibility, loadKBPayloadWithContent } from '../../../../server/kb-data'

async function getPublicSearchDocs(orgSlug: string, kbSlug: string) {
  'use cache'
  cacheTag(kbTag(orgSlug, kbSlug))
  cacheLife('max')
  const { articles } = await getPublicKBPayloadWithContent(orgSlug, kbSlug)
  const fullPaths = getArticleSlugPaths(articles)
  return buildKBSearchIndex(articles, fullPaths)
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ orgSlug: string; kbSlug: string }> }
) {
  const { orgSlug, kbSlug } = await params

  const visibility = await getKBVisibility(orgSlug, kbSlug)
  if (!visibility || visibility.publishStatus === 'DRAFT') {
    return new Response('Not Found', { status: 404 })
  }

  if (visibility.visibility === 'PUBLIC') {
    const docs = await getPublicSearchDocs(orgSlug, kbSlug)
    return Response.json(docs, {
      headers: { 'cache-control': 'public, s-maxage=31536000, stale-while-revalidate=60' },
    })
  }

  // INTERNAL: gate on session + per-KB access, never cache. Denials stay an
  // opaque 404 — this surface has no UI to explain anything, and a 403 would
  // confirm the KB exists to a caller who may not even be a member.
  const session = await getLocalSession()
  if (!session) {
    return new Response('Not Found', { status: 404 })
  }
  if (!(await canViewKB(visibility.id, visibility.organizationId, session.userId))) {
    return new Response('Not Found', { status: 404 })
  }

  const { articles } = await loadKBPayloadWithContent(orgSlug, kbSlug, {
    session: { userId: session.userId },
  })
  const fullPaths = getArticleSlugPaths(articles)
  const docs = buildKBSearchIndex(articles, fullPaths)
  return Response.json(docs, {
    headers: { 'cache-control': 'private, no-store' },
  })
}
