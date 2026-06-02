// apps/web/src/components/kb/ui/editor/article-diff-view.tsx
'use client'

import type { ArticleDiff, BlockDiff } from '@auxx/lib/kb/blocks'
import { Button } from '@auxx/ui/components/button'
import type { ArticleNodeJSON, DiffDecorations, DocJSON } from '@auxx/ui/components/kb/article'
import { KBArticleNode } from '@auxx/ui/components/kb/article'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { cn } from '@auxx/ui/lib/utils'
import { ArrowLeft } from 'lucide-react'
import { useMemo } from 'react'
import { buildDiffRender } from './article-diff-tree'
import styles from './article-diff-view.module.css'

interface ArticleDiffViewProps {
  diff: ArticleDiff
  /** Older side label, e.g. "Published" / "v3" / "Before". */
  baseLabel?: string
  /** Newer side label, e.g. "Draft" / "Kopilot". */
  compareLabel?: string
  /** Clears the `?diff=` param and returns to the editor. */
  onClose: () => void
}

/**
 * Inline-highlighted article diff. Fills the editor pane (in place of
 * `<ArticleEditor>`): a slim diff bar on top, then the compare-side article
 * rendered through the shared `KBArticleNode`, with added/removed/changed
 * blocks decorated and word-level ins/del shown inside modified text blocks —
 * including container-nested changes inside tables, tabs, and accordions.
 */
export function ArticleDiffView({
  diff,
  baseLabel = 'Before',
  compareLabel = 'After',
  onClose,
}: ArticleDiffViewProps) {
  // The nodes to render, with modified text blocks rebuilt to carry their word
  // diff and modified containers reconstructed; `decorations` carries the status
  // of every container-nested leaf. Assembled as one doc so ordered concerns
  // (list numbering) resolve against the full sequence.
  const { nodes: renderNodes, decorations } = useMemo(
    () => buildDiffRender(diff.blocks),
    [diff.blocks]
  )
  const renderDoc: DocJSON = useMemo(() => ({ type: 'doc', content: renderNodes }), [renderNodes])

  const { added, removed, modified, moved } = diff.stats
  const hasChanges = added + removed + modified + moved > 0

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='flex w-full items-center gap-3 border-b bg-primary-150 px-3 py-1.5'>
        <Button variant='outline' size='xs' onClick={onClose}>
          <ArrowLeft /> Back
        </Button>
        <span className='text-xs text-muted-foreground'>
          {baseLabel} <span className='px-1'>→</span> {compareLabel}
        </span>
        <div className='ml-auto flex items-center gap-3 text-xs text-muted-foreground'>
          <LegendChip color='emerald' label='Added' count={added} />
          <LegendChip color='red' label='Removed' count={removed} />
          <LegendChip color='amber' label='Changed' count={modified} />
        </div>
      </div>

      <ScrollArea className='flex-1'>
        <div className='mx-auto w-full max-w-3xl px-7 py-6'>
          {hasChanges ? (
            <article className={styles.body}>
              {diff.blocks.map((d, idx) => (
                <DiffBlock
                  key={d.id || idx}
                  diff={d}
                  node={renderNodes[idx]}
                  idx={idx}
                  doc={renderDoc}
                  decorations={decorations}
                />
              ))}
            </article>
          ) : (
            <p className='py-12 text-center text-sm text-muted-foreground'>
              No changes between {baseLabel} and {compareLabel}.
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

function DiffBlock({
  diff,
  node,
  idx,
  doc,
  decorations,
}: {
  diff: BlockDiff
  node: ArticleNodeJSON
  idx: number
  doc: DocJSON
  decorations: DiffDecorations
}) {
  const decorated = decoratorClass(diff)
  return (
    <div className={cn(styles.block, decorated)}>
      <KBArticleNode node={node} idx={idx} doc={doc} decorations={decorations} />
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

/**
 * Pick the outer decorator class for a top-level block diff. Modified
 * containers carry their detail on the nested leaves (via `decorations`), so we
 * drop the outer frame for them to avoid double-bordering.
 */
function decoratorClass(diff: BlockDiff): string | undefined {
  switch (diff.status) {
    case 'added':
      return styles.added
    case 'removed':
      return styles.removed
    case 'modified':
      return diff.children?.length ? undefined : styles.modified
    case 'moved':
      // Moved-block rendering is deferred (no badge yet); still surface a
      // changed frame when the move also carried content edits.
      if (diff.children?.length) return undefined
      return diff.inline?.length ? styles.modified : undefined
    default:
      return undefined
  }
}
