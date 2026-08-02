// apps/web/src/app/(protected)/preview/kb/md/[knowledgeBaseId]/[[...articleSlug]]/route.ts

import { database } from '@auxx/database'
import { articleToMarkdown, KBService } from '@auxx/lib/kb'
import { getCapabilities } from '@auxx/lib/permissions'
import {
  findArticleBySlugPath,
  findFirstNavigableUnder,
  getFullSlugPath,
} from '@auxx/ui/components/kb'
import { headers } from 'next/headers'
import { auth } from '~/auth/server'

interface RouteParams {
  params: Promise<{ knowledgeBaseId: string; articleSlug?: string[] }>
}

/**
 * Plain-Markdown preview of a KB article's draft revision. Reached via
 * `/preview/kb/<id>/<slug>.md` after `proxy.ts` rewrites the suffix onto
 * this internal `md` segment. Auth happens here because route handlers don't
 * inherit the (protected) layout's auth check — and that layout is a bare
 * `<div>` anyway, so there is no second line of defence.
 *
 * Gated on instance **`view`** of the requested KnowledgeBase, matching the
 * tRPC sibling `kb.getArticles` (`capabilityProcedure` +
 * `assertViewInstance('kb', kbId)`) and the SSE route
 * (`api/kb/articles/[articleId]/events`). Before this, session + org membership
 * was the whole check, so any authenticated org member could read the full
 * DRAFT Markdown body of any article in any KB in the org — including hidden
 * `source` KBs, AI Memory, and unpublished drafts.
 *
 * The gate keys on the URL's KB because that is the KB whose placement tree is
 * walked below (`getArticles` is KB-scoped): reads are placement-permissive, so
 * an article homed elsewhere but linked into a KB the viewer holds stays
 * readable through that KB, exactly as `kb.getArticles` already allows.
 *
 * ⚠ Route handlers get no `auxxErrorMiddleware`, so the denial is a hand-mapped
 * status code — an `AuxxError` thrown here would surface as a 500.
 */
export async function GET(req: Request, { params }: RouteParams): Promise<Response> {
  const { knowledgeBaseId, articleSlug = [] } = await params

  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return new Response('Unauthorized', { status: 401 })

  const orgId = (session.user as { defaultOrganizationId?: string | null }).defaultOrganizationId
  if (!orgId) return new Response('Forbidden', { status: 403 })

  const capabilities = await getCapabilities(session.user.id, orgId)
  if (!capabilities.canViewInstance('kb', knowledgeBaseId)) {
    return new Response('Forbidden', { status: 403 })
  }

  const service = new KBService(database, orgId)
  const articles = await service.getArticles(knowledgeBaseId, { includeUnpublished: true })

  const matched = articleSlug.length
    ? findArticleBySlugPath(articles, articleSlug)
    : findFirstNavigableUnder(null, articles)
  if (!matched) return new Response('Not Found', { status: 404 })

  if (matched.articleKind === 'tab' || matched.articleKind === 'header') {
    const first = findFirstNavigableUnder(matched.id, articles)
    if (!first) return new Response('Not Found', { status: 404 })
    const target = `/preview/kb/${knowledgeBaseId}/${getFullSlugPath(first, articles)}.md`
    return Response.redirect(new URL(target, req.url), 308)
  }

  // Re-fetch to get heavy contentJson; getArticles omits it for list shape.
  const editor = await service.getArticleById(matched.id, knowledgeBaseId)
  const body = articleToMarkdown({ title: editor.title, contentJson: editor.contentJson })
  const md = editor.title?.trim() ? `# ${editor.title}\n\n${body}` : body

  return new Response(md, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': 'private, no-store',
    },
  })
}
