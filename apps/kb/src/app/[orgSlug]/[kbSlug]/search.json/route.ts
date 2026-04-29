// apps/kb/src/app/[orgSlug]/[kbSlug]/search.json/route.ts

import { buildKBSearchIndex, getArticleSlugPaths } from '@auxx/ui/components/kb'
import { cacheLife, cacheTag } from 'next/cache'
import { getKBPayloadWithContent, kbTag } from '../../../../server/kb-cache'

async function getSearchDocs(orgSlug: string, kbSlug: string) {
  'use cache'
  cacheTag(kbTag(orgSlug, kbSlug))
  cacheLife('max')
  const { articles } = await getKBPayloadWithContent(orgSlug, kbSlug)
  const fullPaths = getArticleSlugPaths(articles)
  return buildKBSearchIndex(articles, fullPaths)
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ orgSlug: string; kbSlug: string }> }
) {
  const { orgSlug, kbSlug } = await params
  const docs = await getSearchDocs(orgSlug, kbSlug)
  return Response.json(docs, {
    headers: { 'cache-control': 'public, s-maxage=31536000, stale-while-revalidate=60' },
  })
}
