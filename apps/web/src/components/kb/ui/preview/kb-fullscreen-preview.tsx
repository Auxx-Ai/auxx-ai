// apps/web/src/components/kb/ui/preview/kb-fullscreen-preview.tsx
'use client'

import {
  type DocJSON,
  extractKBHeadings,
  findArticleBySlugPath,
  findFirstNavigableUnder,
  getArticleNeighbours,
  getArticleParentLink,
  KBArticlePager,
  KBArticleRenderer,
  KBLayout,
  KBTableOfContents,
} from '@auxx/ui/components/kb'
import { useArticleContent } from '../../hooks/use-article-content'
import { useArticleList } from '../../hooks/use-article-list'
import { useKnowledgeBase } from '../../hooks/use-knowledge-base'
import { mapKBForPreview } from './map-kb-for-preview'

interface KBFullscreenPreviewProps {
  knowledgeBaseId: string
  /** Slug path from the URL catch-all, e.g. `["docs", "intro"]`. */
  slugPath: string[]
}

/**
 * Standalone fullscreen render of a KB, served at `/preview/kb/<id>[/<slug>...]`.
 * Renders the author's current draft so unsaved changes show up before publish.
 * Admin-only via the surrounding (protected) layout. Real `<Link>` navigation
 * between articles.
 */
export function KBFullscreenPreview({ knowledgeBaseId, slugPath }: KBFullscreenPreviewProps) {
  const { knowledgeBase } = useKnowledgeBase(knowledgeBaseId)
  const articles = useArticleList(knowledgeBaseId)

  const matchedArticle = slugPath.length > 0 ? findArticleBySlugPath(articles, slugPath) : undefined
  // Tabs and headers are pure containers — resolve to their first navigable
  // descendant so the preview never tries to render a body-less article. The
  // public route does this via a 308; we do it client-side here.
  const resolvedArticle =
    matchedArticle &&
    (matchedArticle.articleKind === 'tab' || matchedArticle.articleKind === 'header')
      ? findFirstNavigableUnder(matchedArticle.id, articles)
      : matchedArticle
  const activeArticle =
    resolvedArticle ??
    articles.find((a) => a.articleKind === 'page' || a.articleKind === 'category')
  const articleId = activeArticle?.id ?? null
  const { draftContentJson, draftDescription } = useArticleContent(articleId, knowledgeBaseId)

  if (!knowledgeBase) return null

  const basePath = `/preview/kb/${knowledgeBaseId}`
  const docJson = (draftContentJson ?? null) as DocJSON | null
  const headings = docJson ? extractKBHeadings(docJson) : []
  const { prev, next } = articleId
    ? getArticleNeighbours(articles, articleId)
    : { prev: undefined, next: undefined }
  const parent = getArticleParentLink(activeArticle, articles, basePath)

  return (
    <div className='h-dvh overflow-y-auto'>
      <KBLayout
        kb={mapKBForPreview(knowledgeBase)}
        articles={articles}
        basePath={basePath}
        activeArticleId={activeArticle?.id}>
        {articleId ? (
          <div className='flex min-w-0 flex-1 flex-col'>
            <div className='flex flex-col gap-6 @kb-lg:flex-row @kb-lg:items-start'>
              <aside className='hidden @kb-lg:sticky @kb-lg:top-20 @kb-lg:order-2 @kb-lg:block @kb-lg:max-h-[calc(100dvh-5rem)] @kb-lg:w-64 @kb-lg:max-w-none @kb-lg:flex-none @kb-lg:overflow-y-auto @kb-lg:px-4 @kb-lg:pt-8'>
                <KBTableOfContents headings={headings} />
              </aside>
              <div className='min-w-0 flex-1 @kb-lg:order-1'>
                <KBArticleRenderer
                  doc={docJson}
                  title={activeArticle?.title}
                  emoji={activeArticle?.emoji}
                  description={draftDescription ?? activeArticle?.description}
                  parent={parent}
                />
              </div>
            </div>
            <div className='mt-auto w-full max-w-3xl px-6'>
              <KBArticlePager articles={articles} prev={prev} next={next} basePath={basePath} />
            </div>
          </div>
        ) : (
          <div className='p-8 opacity-70'>No articles yet.</div>
        )}
      </KBLayout>
    </div>
  )
}
