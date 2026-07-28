// apps/kb/src/app/md/[orgSlug]/[kbSlug]/[...articleSlug]/route.ts

import { articleToMarkdown } from '@auxx/lib/kb/markdown'
import {
  findArticleBySlugPath,
  findFirstNavigableUnder,
  getFullSlugPath,
} from '@auxx/ui/components/kb'
import { cacheLife, cacheTag } from 'next/cache'
import { getLocalSession } from '~/lib/auth'
import { canViewKB } from '../../../../../server/kb-access'
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
    return toResponse(
      await loadPublicMarkdown(orgSlug, kbSlug, articleSlug),
      req.url,
      'public, s-maxage=31536000, stale-while-revalidate=60'
    )
  }

  // Denials stay an opaque 404 for the same reason as `search.json`.
  const session = await getLocalSession()
  if (!session) return new Response('Not Found', { status: 404 })
  if (!(await canViewKB(visibility.id, visibility.organizationId, session.userId))) {
    return new Response('Not Found', { status: 404 })
  }

  const { articles } = await loadKBPayloadWithContent(orgSlug, kbSlug, {
    session: { userId: session.userId },
  })
  return toResponse(
    resolveArticleMarkdown({ orgSlug, kbSlug, articleSlug, articles }),
    req.url,
    'private, no-store'
  )
}

/**
 * The PUBLIC branch's cached half.
 *
 * Everything crossing a `'use cache'` boundary must be serializable, in BOTH
 * directions — which is why this returns a {@link MarkdownResult} descriptor
 * rather than a `Response`, and why it takes no `Request`. It previously did
 * both: the `Response` could not be written into a cache entry (the route 500'd
 * on every public hit), and passing the whole request made the cache key vary
 * per URL, so the entry could never have been reused even if it had serialized.
 * Nobody noticed because `proxy.ts` sat at the package root and never rewrote
 * `.md` onto this path at all.
 */
async function loadPublicMarkdown(
  orgSlug: string,
  kbSlug: string,
  articleSlug: string[]
): Promise<MarkdownResult> {
  'use cache'
  const slugPath = articleSlug.join('/')
  cacheTag(kbTag(orgSlug, kbSlug), kbArticleTag(orgSlug, kbSlug, slugPath))
  cacheLife('max')

  const { articles } = await getPublicKBPayloadWithContent(orgSlug, kbSlug)
  return resolveArticleMarkdown({ orgSlug, kbSlug, articleSlug, articles })
}

/** Serializable outcome of resolving one `.md` request — safe to cache. */
type MarkdownResult =
  | { kind: 'notFound' }
  | { kind: 'redirect'; target: string }
  | { kind: 'markdown'; body: string }

interface ResolveInput {
  orgSlug: string
  kbSlug: string
  articleSlug: string[]
  articles: PublicArticleFull[]
}

function resolveArticleMarkdown({
  orgSlug,
  kbSlug,
  articleSlug,
  articles,
}: ResolveInput): MarkdownResult {
  const article = findArticleBySlugPath(articles, articleSlug)
  if (!article) return { kind: 'notFound' }

  if (article.articleKind === 'tab' || article.articleKind === 'header') {
    const first = findFirstNavigableUnder(article.id, articles, { publishedOnly: true })
    if (!first) return { kind: 'notFound' }
    return {
      kind: 'redirect',
      target: `/${orgSlug}/${kbSlug}/${getFullSlugPath(first, articles)}.md`,
    }
  }

  const body = articleToMarkdown({ title: article.title, contentJson: article.contentJson })
  return { kind: 'markdown', body: article.title?.trim() ? `# ${article.title}\n\n${body}` : body }
}

function toResponse(result: MarkdownResult, requestUrl: string, cacheControl: string): Response {
  if (result.kind === 'notFound') return new Response('Not Found', { status: 404 })
  if (result.kind === 'redirect') {
    return Response.redirect(new URL(result.target, requestUrl), 308)
  }

  return new Response(result.body, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': cacheControl,
    },
  })
}
