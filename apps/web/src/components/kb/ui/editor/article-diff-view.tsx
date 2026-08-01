// apps/web/src/components/kb/ui/editor/article-diff-view.tsx
'use client'

import type { ArticleDiff, BlockDiff } from '@auxx/lib/kb/blocks'
import { KBThemeProvider, type KBThemeProviderProps } from '@auxx/ui/components/kb'
import type { ArticleNodeJSON, DiffDecorations, DocJSON } from '@auxx/ui/components/kb/article'
import { KBArticleNode, kbArticleContainerClass } from '@auxx/ui/components/kb/article'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { cn } from '@auxx/ui/lib/utils'
import { useTheme } from 'next-themes'
import { useMemo } from 'react'
import type { ArticleMeta } from '../../store/article-store'
import { buildDiffRender } from './article-diff-tree'
import styles from './article-diff-view.module.css'
import { ArticleEditorHeader } from './article-editor-header'

interface ArticleDiffViewProps {
  diff: ArticleDiff
  /** Article whose editor header is reused as the diff bar. */
  article: ArticleMeta
  knowledgeBaseId: string
  /** Older side label, e.g. "Published" / "v3" / "Before". */
  baseLabel?: string
  /** Newer side label, e.g. "Draft" / "Kopilot". */
  compareLabel?: string
  /**
   * KB theme to render the blocks under, so callouts/tables/code/links match
   * the published article (their colors come from `--kb-*` tokens injected by
   * `KBThemeProvider`). Map a store KnowledgeBase with `mapKBForPreview`.
   * Light/dark follows the app — not the KB's own mode — since the diff lives
   * in the editor pane.
   */
  kbTheme: KBThemeProviderProps['kb']
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
  article,
  knowledgeBaseId,
  baseLabel = 'Before',
  compareLabel = 'After',
  kbTheme,
  onClose,
}: ArticleDiffViewProps) {
  // The nodes to render, with modified text blocks rebuilt to carry their word
  // diff and modified containers reconstructed; `decorations` carries the status
  // of every container-nested leaf. Assembled as one doc so ordered concerns
  // (list numbering) resolve against the full sequence.
  const { entries: renderEntries, decorations } = useMemo(
    () => buildDiffRender(diff.blocks),
    [diff.blocks]
  )
  const renderDoc: DocJSON = useMemo(
    () => ({ type: 'doc', content: renderEntries.map((e) => e.node) }),
    [renderEntries]
  )

  const { added, removed, modified, moved } = diff.stats
  const hasChanges = added + removed + modified + moved > 0

  // The diff renders in the editor pane, so its light/dark should track the app
  // (not the KB's stored mode). Pin the provider mode to the app's resolved
  // theme and disable cookie sync so the KB's own mode preference can't override
  // it. KB *colors* still come from `kbTheme`.
  const { resolvedTheme } = useTheme()
  const appMode = resolvedTheme === 'dark' ? 'dark' : 'light'

  return (
    <KBThemeProvider kb={kbTheme} mode={appMode} syncModeFromCookie={false}>
      <ArticleEditorHeader
        article={article}
        knowledgeBaseId={knowledgeBaseId}
        diff={{ baseLabel, compareLabel, stats: diff.stats, onClose }}
      />

      <ScrollArea className='flex-1'>
        <div className='mx-auto w-full max-w-3xl px-7 py-6'>
          {hasChanges ? (
            <article className={cn(kbArticleContainerClass, styles.body)}>
              {renderEntries.map(({ diff: d, node }, idx) => (
                <DiffBlock
                  key={d.id || idx}
                  diff={d}
                  node={node}
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
    </KBThemeProvider>
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
