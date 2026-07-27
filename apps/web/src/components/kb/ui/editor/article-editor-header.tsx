// apps/web/src/components/kb/ui/editor/article-editor-header.tsx
'use client'

import type { ArticleDiff } from '@auxx/lib/kb/blocks'
import { Button } from '@auxx/ui/components/button'
import { getFullSlugPath, getKbPreviewHref } from '@auxx/ui/components/kb/utils'
import { cn } from '@auxx/ui/lib/utils'
import { Cog, Eye, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useArticleList } from '../../hooks/use-article-list'
import type { ArticleMeta } from '../../store/article-store'
import { useArticleEditorSurface } from './article-editor-surface'
import { ArticlePublishCluster } from './article-publish-cluster'
import { ArticleSettingsDialog } from './article-settings-dialog'
import { HiddenParentBadge } from './hidden-parent-badge'
import { useKBEditorAccess } from './kb-editor-access-context'

interface DiffHeaderInfo {
  /** Older side label, e.g. "Published" / "v3" / "Before". */
  baseLabel: string
  /** Newer side label, e.g. "Draft" / "Kopilot". */
  compareLabel: string
  /** Change counts driving the legend chips. */
  stats: ArticleDiff['stats']
  /** Clears the `?diff=` param and returns to the editor. */
  onClose: () => void
}

interface ArticleEditorHeaderProps {
  article: ArticleMeta
  knowledgeBaseId: string
  /**
   * When present, the header renders in diff mode: a `base → compare` label and
   * an X close button after the hidden-parent badge, and the change legend in
   * place of the Preview button. The left cluster (Page settings, publish
   * status, hidden-parent badge) stays unchanged.
   */
  diff?: DiffHeaderInfo
}

export function ArticleEditorHeader({ article, knowledgeBaseId, diff }: ArticleEditorHeaderProps) {
  const { canEdit } = useKBEditorAccess()
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const articles = useArticleList(knowledgeBaseId)
  // Source-owned KBs aren't independently publishable, so the embedding surface
  // hides the publish cluster + Preview link entirely.
  const { hidePublishing } = useArticleEditorSurface()

  const previewHref = useMemo(
    () => getKbPreviewHref(knowledgeBaseId, getFullSlugPath(article, articles)),
    [article, articles, knowledgeBaseId]
  )

  return (
    <div className='flex w-full items-center gap-2 overflow-x-auto no-scrollbar border-b bg-primary-150 px-3 py-1.5 rounded-b-none'>
      {canEdit && (
        <Button
          variant='outline'
          size='xs'
          className='shrink-0'
          onClick={() => setIsSettingsOpen(true)}>
          <Cog /> Page settings
        </Button>
      )}
      {!hidePublishing && canEdit && (
        <ArticlePublishCluster article={article} knowledgeBaseId={knowledgeBaseId} />
      )}
      <HiddenParentBadge article={article} knowledgeBaseId={knowledgeBaseId} />
      {diff ? (
        <>
          <span className='shrink-0 text-xs text-muted-foreground'>
            {diff.baseLabel} <span className='px-1'>→</span> {diff.compareLabel}
          </span>
          <Button
            variant='destructive-hover'
            size='icon-xs'
            className='shrink-0'
            onClick={diff.onClose}
            aria-label='Close diff'>
            <X />
          </Button>
          <div className='ml-auto flex shrink-0 items-center gap-3 text-xs text-muted-foreground'>
            <LegendChip color='emerald' label='Added' count={diff.stats.added} />
            <LegendChip color='red' label='Removed' count={diff.stats.removed} />
            <LegendChip color='amber' label='Changed' count={diff.stats.modified} />
          </div>
        </>
      ) : hidePublishing ? null : (
        <Button variant='outline' size='xs' className='ml-auto shrink-0' asChild>
          <a href={previewHref} target='_blank' rel='noopener'>
            <Eye /> Preview
          </a>
        </Button>
      )}
      <ArticleSettingsDialog
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        article={article}
        knowledgeBaseId={knowledgeBaseId}
      />
    </div>
  )
}

function LegendChip({
  color,
  label,
  count,
}: {
  color: 'emerald' | 'red' | 'amber'
  label: string
  count: number
}) {
  const dot =
    color === 'emerald' ? 'bg-emerald-500' : color === 'red' ? 'bg-red-500' : 'bg-amber-500'
  return (
    <span className='inline-flex items-center gap-1.5'>
      <span className={cn('inline-block size-2 rounded-full', dot)} />
      {label}
      {count > 0 ? <span className='font-medium text-foreground'>{count}</span> : null}
    </span>
  )
}
