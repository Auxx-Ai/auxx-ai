// apps/web/src/components/kb/ui/editor/article-diff-pane.tsx
'use client'

import { diffBlocks } from '@auxx/lib/kb/blocks'
import { toastError } from '@auxx/ui/components/toast'
import { Loader2 } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { api } from '~/trpc/react'
import { useArticleContent } from '../../hooks/use-article-content'
import type { ArticleMeta } from '../../store/article-store'
import { ArticleDiffView } from './article-diff-view'

interface ArticleDiffPaneProps {
  article: ArticleMeta
  knowledgeBaseId: string
  /** The raw `?diff=` value: `review` | `v:<revisionId>` | `kopilot`. */
  diffValue: string
  onClose: () => void
}

/**
 * Resolves the two sides of a diff for the current `?diff=` value and renders
 * `<ArticleDiffView>` in the editor pane. Draft-vs-published reads operands
 * already on the client (no roundtrip); version-vs-published fetches via
 * `kb.getArticleDiff`.
 */
export function ArticleDiffPane({
  article,
  knowledgeBaseId,
  diffValue,
  onClose,
}: ArticleDiffPaneProps) {
  const isVersion = diffValue.startsWith('v:')
  const revisionId = isVersion ? diffValue.slice(2) : null
  const isKopilot = diffValue === 'kopilot'
  const isSupported = diffValue === 'review' || isVersion || isKopilot

  // Always called (hooks can't be conditional); the base query is the
  // already-cached article content, so 'review' costs no extra roundtrip.
  const {
    draftContentJson,
    publishedContentJson,
    isLoading: contentLoading,
  } = useArticleContent(article.id, knowledgeBaseId)

  const versionQuery = api.kb.getArticleDiff.useQuery(
    { articleId: article.id, base: revisionId ?? '', compare: 'published' },
    { enabled: isVersion && !!revisionId }
  )

  // Kopilot turn review: base = pre-turn snapshot, compare = current draft.
  const reviewQuery = api.kb.getKopilotTurnReview.useQuery(
    { articleId: article.id },
    { enabled: isKopilot }
  )

  // Bail on unsupported values or a failed/empty fetch (version gone, or the
  // Kopilot snapshot already cleared/expired so there's nothing to review).
  useEffect(() => {
    if (!isSupported) {
      onClose()
      return
    }
    if (isVersion && versionQuery.isError) {
      toastError({ title: 'Could not load diff', description: 'This version may no longer exist.' })
      onClose()
    }
    if (isKopilot && !reviewQuery.isLoading && !reviewQuery.data) {
      onClose()
    }
  }, [
    isSupported,
    isVersion,
    versionQuery.isError,
    isKopilot,
    reviewQuery.isLoading,
    reviewQuery.data,
    onClose,
  ])

  const resolved = useMemo(() => {
    if (isVersion) {
      const d = versionQuery.data
      if (!d) return null
      return {
        base: d.base?.contentJson ?? null,
        compare: d.compare?.contentJson ?? null,
        baseLabel: d.base?.versionNumber != null ? `v${d.base.versionNumber}` : 'Version',
        compareLabel:
          d.compare?.versionNumber != null ? `v${d.compare.versionNumber}` : 'Published',
      }
    }
    if (isKopilot) {
      const r = reviewQuery.data
      if (!r) return null
      return {
        base: r.base,
        compare: draftContentJson ?? null,
        baseLabel: 'Before',
        compareLabel: 'Kopilot',
      }
    }
    return {
      base: publishedContentJson,
      compare: draftContentJson,
      baseLabel: 'Published',
      compareLabel: 'Draft',
    }
  }, [
    isVersion,
    isKopilot,
    versionQuery.data,
    reviewQuery.data,
    publishedContentJson,
    draftContentJson,
  ])

  const diff = useMemo(
    () => (resolved ? diffBlocks(resolved.base, resolved.compare) : null),
    [resolved]
  )

  const loading = isVersion
    ? versionQuery.isLoading
    : isKopilot
      ? reviewQuery.isLoading
      : contentLoading
  if (!isSupported || loading || !diff || !resolved) {
    return (
      <div className='flex min-h-0 flex-1 items-center justify-center'>
        <Loader2 className='size-5 animate-spin text-muted-foreground' />
      </div>
    )
  }

  return (
    <ArticleDiffView
      diff={diff}
      baseLabel={resolved.baseLabel}
      compareLabel={resolved.compareLabel}
      onClose={onClose}
    />
  )
}
