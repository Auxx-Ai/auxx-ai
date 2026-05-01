// apps/kb/src/app/_md/[orgSlug]/[kbSlug]/[...articleSlug]/route.ts

import { isOrgMember } from '@auxx/lib/cache'
import { articleToMarkdown } from '@auxx/lib/kb/markdown'
import {
  findArticleBySlugPath,
  findFirstNavigableUnder,
  getFullSlugPath,
} from '@auxx/ui/components/kb'
import { cacheLife, cacheTag } from 'next/cache'
import { getLocalSession } from '~/lib/auth'
import {
  getCachedKBVisibility,
  getPublicKBPayloadWithContent,
  kbArticleTag,
  kbTag,
} from '../../../../../server/kb-cache'
import { loadKBPayloadWithContent, type PublicArticleFull } from '../../../../../server/kb-data'

interface RouteParams {
  params: Promise<{ orgSlug: string; kbSlug: string; articleSlug: string[] }>
}

/**
 * Plain-Markdown rendering of a published KB article. Reached via the
 * `/<org>/<kb>/<...slug>.md` URL after `proxy.ts` rewrites the suffix onto
 * this internal path. Mirrors `[...articleSlug]/page.tsx`'s visibility / auth
 * gate and 308-redirects container articles (tabs/headers) to the first
 * navigable child's `.md` URL.
 */
export async function GET(req: Request, { params }: RouteParams): Promise<Response> {
  const { orgSlug, kbSlug, articleSlug } = await params

  const visibility = await getCachedKBVisibility(orgSlug, kbSlug)
  if (!visibility || visibility.publishStatus === 'DRAFT') {
    return new Response('Not Found', { status: 404 })
  }

  if (visibility.visibility === 'PUBLIC') {
    return renderPublic(req, orgSlug, kbSlug, articleSlug)
  }

  const session = await getLocalSession()
  if (!session) return new Response('Not Found', { status: 404 })
  const member = await isOrgMember(visibility.organizationId, session.userId)
  if (!member) return new Response('Not Found', { status: 404 })

  const { articles } = await loadKBPayloadWithContent(orgSlug, kbSlug, {
    session: { userId: session.userId },
  })
  return renderArticleMarkdown({
    requestUrl: req.url,
    orgSlug,
    kbSlug,
    articleSlug,
    articles,
    cacheControl: 'private, no-store',
  })
}

async function renderPublic(
  req: Request,
  orgSlug: string,
  kbSlug: string,
  articleSlug: string[]
): Promise<Response> {
  'use cache'
  const slugPath = articleSlug.join('/')
  cacheTag(kbTag(orgSlug, kbSlug), kbArticleTag(orgSlug, kbSlug, slugPath))
  cacheLife('max')

  const { articles } = await getPublicKBPayloadWithContent(orgSlug, kbSlug)
  return renderArticleMarkdown({
    requestUrl: req.url,
    orgSlug,
    kbSlug,
    articleSlug,
    articles,
    cacheControl: 'public, s-maxage=31536000, stale-while-revalidate=60',
  })
}

interface RenderInput {
  requestUrl: string
  orgSlug: string
  kbSlug: string
  articleSlug: string[]
  articles: PublicArticleFull[]
  cacheControl: string
}

function renderArticleMarkdown({
  requestUrl,
  orgSlug,
  kbSlug,
  articleSlug,
  articles,
  cacheControl,
}: RenderInput): Response {
  const article = findArticleBySlugPath(articles, articleSlug)
  if (!article) return new Response('Not Found', { status: 404 })

  if (article.articleKind === 'tab' || article.articleKind === 'header') {
    const first = findFirstNavigableUnder(article.id, articles, { publishedOnly: true })
    if (!first) return new Response('Not Found', { status: 404 })
    const target = `/${orgSlug}/${kbSlug}/${getFullSlugPath(first, articles)}.md`
    return Response.redirect(new URL(target, requestUrl), 308)
  }

  const body = articleToMarkdown({ title: article.title, contentJson: article.contentJson })
  const md = article.title?.trim() ? `# ${article.title}\n\n${body}` : body

  return new Response(md, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': cacheControl,
    },
  })
}
