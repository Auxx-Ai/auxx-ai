// apps/web/src/components/kb/ui/preview/kb-preview.tsx
'use client'

import {
  type DocJSON,
  extractKBHeadings,
  getArticleNeighbours,
  KBArticlePager,
  KBArticleRenderer,
  KBLayout,
  KBTableOfContents,
} from '@auxx/ui/components/kb'
import { useEffect, useState } from 'react'
import { useArticleContent } from '../../hooks/use-article-content'
import { useArticleList } from '../../hooks/use-article-list'
import type { KnowledgeBase } from '../../store/knowledge-base-store'
import { KBPreviewTopBar } from './kb-preview-topbar'
import { mapKBForPreview } from './map-kb-for-preview'
import { PreviewProvider, usePreview } from './preview-context'

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
  const { isMobile, isDark, knowledgeBase } = usePreview()
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
  const { contentJson, description } = useArticleContent(articleId, kbId)

  if (!knowledgeBase) return null

  const widthClass = isMobile ? 'w-[420px]' : 'w-full max-w-7xl'
  const docJson = (contentJson ?? null) as DocJSON | null
  const headings = docJson ? extractKBHeadings(docJson) : []
  const { prev, next } = articleId
    ? getArticleNeighbours(articles, articleId)
    : { prev: undefined, next: undefined }

  return (
    <div className='flex flex-1 flex-col'>
      <KBPreviewTopBar kbId={kbId} activeSlugPath={activeSlugPath} />
      <div className='flex flex-1 items-start justify-center overflow-auto bg-muted p-4'>
        <div
          className={`${widthClass} overflow-hidden rounded border border-foreground/10 shadow-sm`}
          style={{ colorScheme: isDark ? 'dark' : 'light' }}>
          <KBLayout
            kb={mapKBForPreview(knowledgeBase)}
            articles={articles}
            basePath='#preview'
            activeArticleId={activeArticle?.id}
            mode={isDark ? 'dark' : 'light'}
            onArticleClick={(id) => setOverrideId(id)}>
            {articleId ? (
              <div className='min-w-0 flex-1'>
                <div className='mx-auto max-w-3xl px-6 pt-4'>
                  <KBTableOfContents headings={headings} />
                </div>
                <KBArticleRenderer
                  doc={docJson}
                  title={activeArticle?.title ?? articles.find((a) => a.id === articleId)?.title}
                  description={description ?? activeArticle?.description}
                />
                <div className='mx-auto max-w-3xl px-6'>
                  <KBArticlePager articles={articles} prev={prev} next={next} basePath='#preview' />
                </div>
              </div>
            ) : (
              <div style={{ padding: '2rem', opacity: 0.7 }}>No articles yet.</div>
            )}
          </KBLayout>
        </div>
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
