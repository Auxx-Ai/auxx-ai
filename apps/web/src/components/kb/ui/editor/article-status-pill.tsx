// apps/web/src/components/kb/ui/editor/article-status-pill.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import type { ArticleMeta } from '../../store/article-store'

interface ArticleStatusPillProps {
  article: Pick<ArticleMeta, 'isPublished' | 'status' | 'hasUnpublishedChanges'>
  className?: string
}

/**
 * Status pill driven by `(article.status, article.isPublished, article.hasUnpublishedChanges)`.
 */
export function ArticleStatusPill({ article, className }: ArticleStatusPillProps) {
  if (article.status === 'ARCHIVED') {
    return (
      <Badge variant='secondary' className={className}>
        Archived
      </Badge>
    )
  }
  if (article.isPublished) {
    if (article.hasUnpublishedChanges) {
      return (
        <Badge variant='amber' className={cn(className, 'shrink-0')}>
          Live · unsaved changes
        </Badge>
      )
    }
    return (
      <Badge variant='emerald' className={className}>
        Live
      </Badge>
    )
  }
  return (
    <Badge variant='secondary' className={className}>
      Draft
    </Badge>
  )
}

export function articleStatusDescription(
  article: Pick<ArticleMeta, 'isPublished' | 'status' | 'hasUnpublishedChanges' | 'publishedAt'>
): string {
  if (article.status === 'ARCHIVED') return 'Hidden from sidebar and the public site.'
  if (article.isPublished) {
    if (article.hasUnpublishedChanges) {
      return 'Your draft has unsaved changes that aren’t live yet.'
    }
    if (article.publishedAt) {
      return `Published ${formatRelative(article.publishedAt)}.`
    }
    return 'Visible publicly.'
  }
  return article.publishedAt ? 'Currently unpublished.' : 'Never published.'
}

function formatRelative(date: Date | string): string {
  const ts = typeof date === 'string' ? new Date(date) : date
  const diffMs = Date.now() - ts.getTime()
  const sec = Math.round(diffMs / 1000)
  const min = Math.round(sec / 60)
  const hour = Math.round(min / 60)
  const day = Math.round(hour / 24)
  if (sec < 60) return 'just now'
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`
  if (hour < 24) return `${hour} hour${hour === 1 ? '' : 's'} ago`
  if (day < 7) return `${day} day${day === 1 ? '' : 's'} ago`
  return ts.toLocaleDateString()
}
