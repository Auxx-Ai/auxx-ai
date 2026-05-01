// apps/web/src/components/kb/ui/sidebar/article-tree-section.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { useDndContext } from '@dnd-kit/core'
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import type { ArticleTreeNode } from '../../store/article-store'
import { usePendingInsertStore } from '../../store/pending-insert-store'
import { ArticleInsertLine } from './article-insert-line'
import { ArticleSidebarItem } from './article-sidebar-item'
import { PendingArticleRow } from './pending-article-row'

interface ArticleTreeSectionProps {
  articles: ArticleTreeNode[]
  level?: number
  knowledgeBaseId: string
  /**
   * The parent under which this section's `articles` live. Used to match the
   * pending-insert store's `parentId` so the inline create-row renders at the
   * right depth. Pass `null` for the KB root or "no active tab".
   */
  parentId: string | null
  articleOpenStates: Record<string, boolean>
  toggleArticleOpen: (articleId: string) => void
}

/**
 * Renders a section of the article tree recursively. Interleaves the inline
 * pending-create row when the pending insert targets this section's parent.
 */
export function ArticleTreeSection({
  articles,
  level = 0,
  knowledgeBaseId,
  parentId,
  articleOpenStates,
  toggleArticleOpen,
}: ArticleTreeSectionProps) {
  // const paddingLeftRem = level === 0 ? 0.5 : 1.125
  const paddingLeftRem = 1.125
  const pending = usePendingInsertStore((s) => s.pending)
  const pendingMatchesThisLevel = pending !== null && pending.parentId === parentId
  const pendingIsAppend = pendingMatchesThisLevel && !pending!.adjacentTo

  return (
    <>
      {articles.map((article) => {
        const hasChildren = article.children && article.children.length > 0
        const renderPendingBefore =
          pendingMatchesThisLevel &&
          pending!.adjacentTo === article.id &&
          pending!.position === 'before'
        const renderPendingAfter =
          pendingMatchesThisLevel &&
          pending!.adjacentTo === article.id &&
          pending!.position === 'after'

        const pendingNode = pending ? (
          <div className='w-full' style={{ paddingLeft: `${paddingLeftRem}rem` }}>
            <PendingArticleRow
              articleKind={pending.articleKind}
              parentId={pending.parentId}
              adjacentTo={pending.adjacentTo}
              position={pending.position}
              knowledgeBaseId={knowledgeBaseId}
            />
          </div>
        ) : null

        // Headers render via ArticleSidebarItem like any other kind, but their
        // children stay at the same depth (no extra indent) and a trailing
        // 'after-group' InsertLine sits below the section. Wrapping the whole
        // group in `HeaderGroupHighlight` lets us draw the inside-drop
        // affordance across the entire section, not just the label row.
        if (article.articleKind === 'header') {
          return (
            <div key={article.id}>
              {renderPendingBefore && pendingNode}
              <HeaderGroupHighlight headerId={article.id}>
                <div className='w-full' style={{ paddingLeft: `${paddingLeftRem}rem` }}>
                  <ArticleSidebarItem article={article} knowledgeBaseId={knowledgeBaseId} />
                </div>
                {hasChildren ? (
                  <div className='relative'>
                    <ArticleTreeSection
                      articles={article.children}
                      level={level}
                      knowledgeBaseId={knowledgeBaseId}
                      parentId={article.id}
                      articleOpenStates={articleOpenStates}
                      toggleArticleOpen={toggleArticleOpen}
                    />
                    <ArticleInsertLine
                      article={article}
                      knowledgeBaseId={knowledgeBaseId}
                      mode='after-group'
                    />
                  </div>
                ) : // No children yet: still let the pending-insert store target
                // this header so the user can create the section's first
                // child without expanding anything.
                pending && pending.parentId === article.id && !pending.adjacentTo ? (
                  <div className='w-full' style={{ paddingLeft: `${paddingLeftRem}rem` }}>
                    <PendingArticleRow
                      articleKind={pending.articleKind}
                      parentId={pending.parentId}
                      adjacentTo={pending.adjacentTo}
                      position={pending.position}
                      knowledgeBaseId={knowledgeBaseId}
                    />
                  </div>
                ) : null}
              </HeaderGroupHighlight>
              {renderPendingAfter && pendingNode}
            </div>
          )
        }

        const isOpen = articleOpenStates[article.id] || false

        return (
          <div key={article.id}>
            {renderPendingBefore && pendingNode}
            <div className='w-full' style={{ paddingLeft: `${paddingLeftRem}rem` }}>
              <ArticleSidebarItem
                article={article}
                knowledgeBaseId={knowledgeBaseId}
                isOpen={isOpen}
                onToggleOpen={toggleArticleOpen}
              />

              {hasChildren && (
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className={cn('relative ')}>
                      <div className='absolute bottom-0 left-[calc(0.5rem)] top-0 z-0 w-px bg-border' />
                      <ArticleTreeSection
                        articles={article.children}
                        level={level + 1}
                        knowledgeBaseId={knowledgeBaseId}
                        parentId={article.id}
                        articleOpenStates={articleOpenStates}
                        toggleArticleOpen={toggleArticleOpen}
                      />
                      <ArticleInsertLine
                        article={article}
                        knowledgeBaseId={knowledgeBaseId}
                        mode='after-group'
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              )}
              {/* Empty open category targeted by pending insert: render the
                  pending row inline (the recursive section above only mounts
                  when there are children). */}
              {!hasChildren &&
                isOpen &&
                pending &&
                pending.parentId === article.id &&
                !pending.adjacentTo && (
                  <div className='relative'>
                    <ArticleTreeSection
                      articles={[]}
                      level={level + 1}
                      knowledgeBaseId={knowledgeBaseId}
                      parentId={article.id}
                      articleOpenStates={articleOpenStates}
                      toggleArticleOpen={toggleArticleOpen}
                    />
                  </div>
                )}
            </div>
            {renderPendingAfter && pendingNode}
          </div>
        )
      })}
      {/* Append at end of this level when no adjacentTo is set. Also covers
          the empty-children case for whichever parent owns this section. */}
      {pendingIsAppend && (
        <div className='w-full' style={{ paddingLeft: `${paddingLeftRem}rem` }}>
          <PendingArticleRow
            articleKind={pending!.articleKind}
            parentId={pending!.parentId}
            adjacentTo={pending!.adjacentTo}
            position={pending!.position}
            knowledgeBaseId={knowledgeBaseId}
          />
        </div>
      )}
    </>
  )
}

/**
 * Wraps a header section so the inside-drop affordance covers the whole group
 * (header label + its children) instead of just the label row. Reads the
 * dnd-kit context so a single dashed border highlights the section any time
 * the dragged article is hovering the header as a drop target.
 */
function HeaderGroupHighlight({ headerId, children }: { headerId: string; children: ReactNode }) {
  const { active, over } = useDndContext()
  const isOver = over?.id === headerId && active?.id !== headerId
  return (
    <div className='relative pb-4'>
      {isOver && (
        <div className='pointer-events-none absolute inset-x-0 inset-y-1 z-10 rounded-md border border-dashed border-primary/40 bg-primary/10' />
      )}
      {children}
    </div>
  )
}
