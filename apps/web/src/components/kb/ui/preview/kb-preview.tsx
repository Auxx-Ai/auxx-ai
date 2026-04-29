// apps/web/src/components/kb/ui/preview/kb-preview.tsx
'use client'

import { KBArticleRenderer, KBLayout } from '@auxx/ui/components/kb'
import { useArticleContent } from '../../hooks/use-article-content'
import { useArticleList } from '../../hooks/use-article-list'
import type { KnowledgeBase } from '../../store/knowledge-base-store'
import { KBPreviewTopBar } from './kb-preview-topbar'
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

  const activeArticle = findActiveArticle(articles, activeSlugPath)
  const articleId = activeArticle?.id ?? articles[0]?.id ?? null
  const { contentJson, description } = useArticleContent(articleId, kbId)

  if (!knowledgeBase) return null

  const widthClass = isMobile ? 'w-[420px]' : 'w-full max-w-[1280px]'

  return (
    <div className='flex flex-1 flex-col'>
      <KBPreviewTopBar />
      <div className='flex flex-1 items-start justify-center overflow-auto bg-muted p-4'>
        <div
          className={`${widthClass} overflow-hidden rounded border border-foreground/10 shadow-sm`}
          style={{ colorScheme: isDark ? 'dark' : 'light' }}>
          <KBLayout
            kb={mapKBForPreview(knowledgeBase)}
            articles={articles}
            basePath='#preview'
            activeArticleId={activeArticle?.id}
            mode={isDark ? 'dark' : 'light'}>
            {articleId ? (
              <KBArticleRenderer
                doc={(contentJson ?? null) as never}
                title={activeArticle?.title ?? articles.find((a) => a.id === articleId)?.title}
                description={description ?? activeArticle?.description}
              />
            ) : (
              <div style={{ padding: '2rem', opacity: 0.7 }}>No articles yet.</div>
            )}
          </KBLayout>
        </div>
      </div>
    </div>
  )
}

function mapKBForPreview(kb: KnowledgeBase) {
  return {
    id: kb.id,
    name: kb.name,
    defaultMode: kb.defaultMode,
    showMode: kb.showMode,
    primaryColorLight: kb.primaryColorLight,
    primaryColorDark: kb.primaryColorDark,
    tintColorLight: kb.tintColorLight,
    tintColorDark: kb.tintColorDark,
    infoColorLight: kb.infoColorLight,
    infoColorDark: kb.infoColorDark,
    successColorLight: kb.successColorLight,
    successColorDark: kb.successColorDark,
    warningColorLight: kb.warningColorLight,
    warningColorDark: kb.warningColorDark,
    dangerColorLight: kb.dangerColorLight,
    dangerColorDark: kb.dangerColorDark,
    fontFamily: kb.fontFamily,
    cornerStyle: kb.cornerStyle,
    logoLight: kb.logoLight,
    logoDark: kb.logoDark,
    searchbarPosition: kb.searchbarPosition,
    headerNavigation: kb.headerNavigation,
    footerNavigation: kb.footerNavigation,
  }
}

function findActiveArticle(
  articles: ReturnType<typeof useArticleList>,
  slugPath: string[] | undefined
) {
  if (!slugPath || slugPath.length === 0) return undefined
  const last = slugPath[slugPath.length - 1]
  return articles.find((a) => a.slug === last)
}
