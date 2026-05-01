// apps/web/src/components/kb/ui/preview/kb-fullscreen-preview.tsx
'use client'

import { Banner } from '@auxx/ui/components/banner'
import {
  type DocJSON,
  extractKBHeadings,
  findArticleBySlugPath,
  findFirstNavigableUnder,
  getArticleNeighbours,
  getArticleParentLink,
  getFullSlugPath,
  KBArticlePager,
  KBArticleRenderer,
  KBLayout,
  KBTableOfContents,
} from '@auxx/ui/components/kb'
import { ExternalLink, Eye } from 'lucide-react'
import { type CSSProperties, useCallback, useState } from 'react'
import { useArticleContent } from '../../hooks/use-article-content'
import { useArticleList } from '../../hooks/use-article-list'
import { useBodyClass } from '../../hooks/use-body-class'
import { useKbPublicUrl } from '../../hooks/use-kb-public-url'
import { useKnowledgeBase } from '../../hooks/use-knowledge-base'
import { ArticleMarkdownCopy } from './article-markdown-copy'
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
  // The global body has `overflow-hidden` so app routes manage their own scroll.
  // The fullscreen preview wants document-level scroll to match the public KB site
  // (header scrolls away naturally with content).
  useBodyClass({ remove: 'overflow-hidden' })

  // Measure the banner so the KB layout's sticky elements (header, tabs, sidebar)
  // can offset themselves below it via the `--kb-top-offset` CSS variable.
  // Callback ref runs after the banner mounts (which can be a later render than
  // this component's first render, since we early-return null while the KB loads).
  const [bannerHeight, setBannerHeight] = useState(0)
  const setBannerRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return
    setBannerHeight(el.offsetHeight)
    const ro = new ResizeObserver(() => setBannerHeight(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { knowledgeBase } = useKnowledgeBase(knowledgeBaseId)
  const articles = useArticleList(knowledgeBaseId)
  const publicUrl = useKbPublicUrl(knowledgeBase?.slug)

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
  const activeFullSlug = activeArticle ? getFullSlugPath(activeArticle, articles) : null
  const markdownHref = activeFullSlug ? `${basePath}/${activeFullSlug}.md` : undefined

  const isLive =
    knowledgeBase.publishStatus === 'PUBLISHED' || knowledgeBase.publishStatus === 'UNLISTED'
  const slugSegment = slugPath.length > 0 ? `/${slugPath.map(encodeURIComponent).join('/')}` : ''
  const liveHref = isLive && publicUrl ? `${publicUrl}${slugSegment}` : null

  return (
    <div style={{ '--kb-top-offset': `${bannerHeight}px` } as CSSProperties}>
      <div ref={setBannerRef} className='sticky top-0 z-30'>
        <Banner
          variant='default'
          icon={<Eye />}
          title='Preview mode'
          action={
            liveHref ? (
              <a
                href={liveHref}
                target='_blank'
                rel='noopener'
                className='inline-flex items-center gap-1 font-medium text-info hover:underline'>
                View live site <ExternalLink className='size-3.5' />
              </a>
            ) : (
              <span className='text-muted-foreground'>Not published yet</span>
            )
          }>
          Viewing draft (includes unpublished changes)
        </Banner>
      </div>
      <KBLayout
        kb={mapKBForPreview(knowledgeBase)}
        articles={articles}
        basePath={basePath}
        activeArticleId={activeArticle?.id}>
        {articleId ? (
          <div className='flex min-w-0 flex-1 flex-col'>
            <div className='flex flex-col gap-6 @kb-lg:flex-row @kb-lg:items-start'>
              <aside className='hidden @kb-lg:sticky @kb-lg:top-[calc(var(--kb-top-offset,0px)+5rem)] @kb-lg:order-2 @kb-lg:block @kb-lg:max-h-[calc(100dvh-var(--kb-top-offset,0px)-5rem)] @kb-lg:w-64 @kb-lg:max-w-none @kb-lg:flex-none @kb-lg:overflow-y-auto @kb-lg:px-4 @kb-lg:pt-8'>
                <KBTableOfContents headings={headings} />
              </aside>
              <div className='min-w-0 flex-1 @kb-lg:order-1'>
                <KBArticleRenderer
                  doc={docJson}
                  title={activeArticle?.title}
                  emoji={activeArticle?.emoji}
                  description={draftDescription ?? activeArticle?.description}
                  parent={parent}
                  copyMenu={
                    <ArticleMarkdownCopy
                      doc={docJson}
                      title={activeArticle?.title}
                      markdownHref={markdownHref}
                    />
                  }
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
