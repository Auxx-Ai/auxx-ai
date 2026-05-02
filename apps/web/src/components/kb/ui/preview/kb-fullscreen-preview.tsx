// apps/web/src/components/kb/ui/preview/kb-fullscreen-preview.tsx
'use client'

import { Banner } from '@auxx/ui/components/banner'
import { Button } from '@auxx/ui/components/button'
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
import { ExternalLink, Eye, Undo2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type CSSProperties, useCallback, useState } from 'react'
import { api } from '~/trpc/react'
import { type PreviewMode, useArticleContent } from '../../hooks/use-article-content'
import { useArticleList } from '../../hooks/use-article-list'
import { useArticleMutations } from '../../hooks/use-article-mutations'
import { useBodyClass } from '../../hooks/use-body-class'
import { useKbPublicUrl } from '../../hooks/use-kb-public-url'
import { useKnowledgeBase } from '../../hooks/use-knowledge-base'
import { ArticleMarkdownCopy } from './article-markdown-copy'
import { mapKBForPreview } from './map-kb-for-preview'
import { PreviewVersionPicker } from './preview-version-picker'

interface KBFullscreenPreviewProps {
  knowledgeBaseId: string
  /** Slug path from the URL catch-all, e.g. `["docs", "intro"]`. */
  slugPath: string[]
  /** Resolved from the `?v=` query param by the server route. */
  mode: PreviewMode
}

/**
 * Standalone fullscreen render of a KB, served at `/preview/kb/<id>[/<slug>...][?v=…]`.
 * Renders draft, the live published revision, or any historical snapshot
 * depending on `mode`. Admin-only via the surrounding (protected) layout.
 */
export function KBFullscreenPreview({ knowledgeBaseId, slugPath, mode }: KBFullscreenPreviewProps) {
  // The global body has `overflow-hidden` so app routes manage their own scroll.
  // The fullscreen preview wants document-level scroll to match the public KB site
  // (header scrolls away naturally with content).
  useBodyClass({ remove: 'overflow-hidden' })

  const router = useRouter()

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
  const {
    previewContentJson,
    previewDescription,
    previewTitle,
    previewEmoji,
    hasPublishedVersion,
    fellBackToDraft,
  } = useArticleContent(articleId, knowledgeBaseId, mode)

  // Versions list — used to label the live banner with vN and to map a
  // historical versionNumber to a revision id for "Restore as draft".
  const versionsQuery = api.kb.getArticleVersions.useQuery(
    { articleId: articleId ?? '' },
    { enabled: !!articleId && (mode === 'live' || (typeof mode === 'object' && mode !== null)) }
  )
  const versions = versionsQuery.data ?? []
  const liveVersionNumber = versions[0]?.versionNumber ?? null
  const historicalVersion =
    typeof mode === 'object' && mode !== null
      ? versions.find((v) => v.versionNumber === mode.versionNumber)
      : undefined

  const { restoreArticleVersion } = useArticleMutations(knowledgeBaseId)

  const handleModeChange = useCallback(
    (next: PreviewMode) => {
      const path = slugPath.length > 0 ? `/${slugPath.map(encodeURIComponent).join('/')}` : ''
      const token = next === 'draft' ? null : next === 'live' ? 'live' : String(next.versionNumber)
      const query = token ? `?v=${token}` : ''
      router.replace(`/preview/kb/${knowledgeBaseId}${path}${query}`)
    },
    [knowledgeBaseId, router, slugPath]
  )

  const handleSwitchToDraft = useCallback(() => handleModeChange('draft'), [handleModeChange])
  const handleRestoreFromBanner = useCallback(async () => {
    if (!historicalVersion) return
    await restoreArticleVersion(historicalVersion.id)
    handleModeChange('draft')
  }, [historicalVersion, restoreArticleVersion, handleModeChange])

  if (!knowledgeBase) return null

  const basePath = `/preview/kb/${knowledgeBaseId}`
  const docJson = (previewContentJson ?? null) as DocJSON | null
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
  const liveSiteHref = isLive && publicUrl ? `${publicUrl}${slugSegment}` : null

  const isHistoricalMode = typeof mode === 'object' && mode !== null
  const bannerVariant = isHistoricalMode || mode === 'live' ? 'warning' : 'default'

  let bannerTitle: string
  let bannerBody: string
  let bannerAction: React.ReactNode

  if (mode === 'draft') {
    bannerTitle = 'Preview mode'
    bannerBody = 'Viewing draft (includes unpublished changes)'
    bannerAction = (
      <>
        {articleId ? (
          <PreviewVersionPicker
            articleId={articleId}
            mode={mode}
            hasPublishedVersion={hasPublishedVersion}
            onModeChange={handleModeChange}
          />
        ) : null}
        {liveSiteHref ? (
          <a
            href={liveSiteHref}
            target='_blank'
            rel='noopener'
            className='inline-flex items-center gap-1 font-medium text-info hover:underline'>
            View live site <ExternalLink className='size-3.5' />
          </a>
        ) : (
          <span className='text-muted-foreground'>Not published yet</span>
        )}
      </>
    )
  } else if (mode === 'live') {
    if (fellBackToDraft) {
      bannerTitle = 'No published version yet'
      bannerBody = 'Showing draft until this article is published.'
    } else {
      bannerTitle = liveVersionNumber
        ? `Viewing the live version (v${liveVersionNumber})`
        : 'Viewing the live version'
      bannerBody = ''
    }
    bannerAction = (
      <>
        {articleId ? (
          <PreviewVersionPicker
            articleId={articleId}
            mode={mode}
            hasPublishedVersion={hasPublishedVersion}
            onModeChange={handleModeChange}
          />
        ) : null}
        <Button variant='outline' size='xs' onClick={handleSwitchToDraft}>
          Switch to draft
        </Button>
      </>
    )
  } else {
    const v = mode.versionNumber
    const labelSuffix = historicalVersion?.label ? ` — “${historicalVersion.label}”` : ''
    const editorName = historicalVersion?.editor?.name ?? null
    const meta = historicalVersion?.createdAt
      ? new Date(historicalVersion.createdAt).toLocaleDateString()
      : null
    bannerTitle = `Viewing v${v}${labelSuffix}`
    bannerBody = [meta ? `published ${meta}` : null, editorName ? `by ${editorName}` : null]
      .filter(Boolean)
      .join(' ')
    bannerAction = (
      <>
        {articleId ? (
          <PreviewVersionPicker
            articleId={articleId}
            mode={mode}
            hasPublishedVersion={hasPublishedVersion}
            onModeChange={handleModeChange}
          />
        ) : null}
        <Button variant='outline' size='xs' onClick={handleSwitchToDraft}>
          Switch to draft
        </Button>
        {historicalVersion ? (
          <Button variant='outline' size='xs' onClick={handleRestoreFromBanner}>
            <Undo2 /> Restore as draft
          </Button>
        ) : null}
      </>
    )
  }

  return (
    <div style={{ '--kb-top-offset': `${bannerHeight}px` } as CSSProperties}>
      <div ref={setBannerRef} className='sticky top-0 z-30'>
        <Banner variant={bannerVariant} icon={<Eye />} title={bannerTitle} action={bannerAction}>
          {bannerBody}
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
                  title={previewTitle ?? activeArticle?.title}
                  emoji={previewEmoji ?? activeArticle?.emoji}
                  description={previewDescription ?? activeArticle?.description}
                  parent={parent}
                  resolveAuxxHref={(id) => `/preview/kb/${knowledgeBaseId}/r/${id}`}
                  copyMenu={
                    <ArticleMarkdownCopy
                      doc={docJson}
                      title={previewTitle ?? activeArticle?.title}
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
