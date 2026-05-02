// apps/web/src/components/kb/ui/preview/kb-preview.tsx
'use client'

import {
  type DocJSON,
  extractKBHeadings,
  getArticleNeighbours,
  getArticleParentLink,
  KBArticlePager,
  KBArticleRenderer,
  KBLayout,
  KBTableOfContents,
} from '@auxx/ui/components/kb'
import { useEffect, useState } from 'react'
import { useArticleContent } from '../../hooks/use-article-content'
import { useArticleList } from '../../hooks/use-article-list'
import { useKbPublicUrl } from '../../hooks/use-kb-public-url'
import type { KnowledgeBase } from '../../store/knowledge-base-store'
import { KBPreviewTopBar } from './kb-preview-topbar'
import { mapKBForPreview } from './map-kb-for-preview'
import { PreviewProvider, usePreview } from './preview-context'
import { DesktopPreviewFrame, MobilePreviewFrame } from './preview-frames'

interface KBPreviewProps {
  knowledgeBase: KnowledgeBase
  /** Slug path of the article currently being edited (e.g. ["docs", "intro"]). */
  activeSlugPath?: string[]
}

export function KBPreview({ knowledgeBase, activeSlugPath }: KBPreviewProps) {
  return (
    <PreviewProvider knowledgeBase={knowledgeBase}>
      <KBPreviewInner kbId={knowledgeBase.id} activeSlugPath={activeSlugPath} />
    </PreviewProvider>
  )
}

function KBPreviewInner({ kbId, activeSlugPath }: { kbId: string; activeSlugPath?: string[] }) {
  const { isMobile, effectiveMode, knowledgeBase, previewMode, setPreviewMode, setOverride } =
    usePreview()
  const articles = useArticleList(kbId)

  // Article from the editor's slug path; resets the override when the editor switches.
  const editorArticle = findActiveArticle(articles, activeSlugPath)
  const [overrideId, setOverrideId] = useState<string | null>(null)
  useEffect(() => {
    setOverrideId(null)
  }, [editorArticle?.id])

  const activeArticle = overrideId
    ? articles.find((a) => a.id === overrideId)
    : (editorArticle ?? articles[0])
  const articleId = activeArticle?.id ?? null

  // Reset the picker to draft whenever the active article changes — covers both
  // editor URL changes and sidebar-click overrides. Otherwise stale "Live" state
  // would leak onto a sibling article that may not even be published.
  useEffect(() => {
    setPreviewMode('draft')
  }, [articleId, setPreviewMode])
  const { previewContentJson, previewDescription, previewTitle, previewEmoji } = useArticleContent(
    articleId,
    kbId,
    previewMode
  )

  const publicUrl = useKbPublicUrl(knowledgeBase?.slug)

  if (!knowledgeBase) return null

  const docJson = (previewContentJson ?? null) as DocJSON | null
  const headings = docJson ? extractKBHeadings(docJson) : []
  const { prev, next } = articleId
    ? getArticleNeighbours(articles, articleId)
    : { prev: undefined, next: undefined }
  const parent = getArticleParentLink(activeArticle, articles, '#preview')

  const isLive =
    knowledgeBase.publishStatus === 'PUBLISHED' || knowledgeBase.publishStatus === 'UNLISTED'
  const browserUrl = isLive && publicUrl ? publicUrl : `(draft) ${knowledgeBase.slug}`

  const layout = (
    <div
      data-slot='kb-preview-color-scheme'
      className='flex min-h-0 flex-1 flex-col'
      style={{ colorScheme: effectiveMode }}>
      <KBLayout
        kb={mapKBForPreview(knowledgeBase)}
        articles={articles}
        basePath='#preview'
        activeArticleId={activeArticle?.id}
        mode={effectiveMode}
        embedded
        mainScroll
        onArticleClick={(id) => setOverrideId(id)}
        onModeChange={setOverride}>
        {articleId ? (
          <div className='flex min-w-0 flex-1 flex-col'>
            <div className='flex flex-col gap-6 @kb-lg:flex-row @kb-lg:items-start'>
              <aside className='hidden @kb-lg:sticky @kb-lg:top-20 @kb-lg:order-2 @kb-lg:block @kb-lg:max-h-[calc(100dvh-5rem)] @kb-lg:w-64 @kb-lg:max-w-none @kb-lg:flex-none @kb-lg:overflow-y-auto @kb-lg:px-4 @kb-lg:pt-8'>
                <KBTableOfContents headings={headings} />
              </aside>
              <div className='min-w-0 flex-1 @kb-lg:order-1'>
                <KBArticleRenderer
                  doc={docJson}
                  title={
                    previewTitle ??
                    activeArticle?.title ??
                    articles.find((a) => a.id === articleId)?.title
                  }
                  emoji={
                    previewEmoji ??
                    activeArticle?.emoji ??
                    articles.find((a) => a.id === articleId)?.emoji
                  }
                  description={previewDescription ?? activeArticle?.description}
                  parent={parent}
                  resolveAuxxHref={(id) => `/preview/kb/${kbId}/r/${id}`}
                />
              </div>
            </div>
            <div className='mt-auto w-full max-w-3xl px-6'>
              <KBArticlePager articles={articles} prev={prev} next={next} basePath='#preview' />
            </div>
          </div>
        ) : (
          <div style={{ padding: '2rem', opacity: 0.7 }}>No articles yet.</div>
        )}
      </KBLayout>
    </div>
  )

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <KBPreviewTopBar kbId={kbId} activeSlugPath={activeSlugPath} articleId={articleId} />
      <div className='flex min-h-0 flex-1 justify-center bg-muted p-4'>
        {isMobile ? (
          <MobilePreviewFrame>{layout}</MobilePreviewFrame>
        ) : (
          <DesktopPreviewFrame url={browserUrl}>{layout}</DesktopPreviewFrame>
        )}
      </div>
    </div>
  )
}

function findActiveArticle(
  articles: ReturnType<typeof useArticleList>,
  slugPath: string[] | undefined
) {
  if (!slugPath || slugPath.length === 0) return undefined
  const last = slugPath[slugPath.length - 1]
  return articles.find((a) => a.slug === last)
}
