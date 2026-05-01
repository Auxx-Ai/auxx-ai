// apps/web/src/components/kb/ui/sidebar/article-tree-section.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { useDndContext } from '@dnd-kit/core'
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import type { ArticleTreeNode } from '../../store/article-store'
import { ArticleInsertLine } from './article-insert-line'
import { ArticleSidebarItem } from './article-sidebar-item'

interface ArticleTreeSectionProps {
  articles: ArticleTreeNode[]
  level?: number
  knowledgeBaseId: string
  articleOpenStates: Record<string, boolean>
  toggleArticleOpen: (articleId: string) => void
}

/**
 * Renders a section of the article tree recursively.
 */
export function ArticleTreeSection({
  articles,
  level = 0,
  knowledgeBaseId,
  articleOpenStates,
  toggleArticleOpen,
}: ArticleTreeSectionProps) {
  // const paddingLeftRem = level === 0 ? 0.5 : 1.125
  const paddingLeftRem = 1.125

  return (
    <>
      {articles.map((article) => {
        const hasChildren = article.children && article.children.length > 0

        // Headers render via ArticleSidebarItem like any other kind, but their
        // children stay at the same depth (no extra indent) and a trailing
        // 'after-group' InsertLine sits below the section. Wrapping the whole
        // group in `HeaderGroupHighlight` lets us draw the inside-drop
        // affordance across the entire section, not just the label row.
        if (article.articleKind === 'header') {
          return (
            <HeaderGroupHighlight key={article.id} headerId={article.id}>
              <div className='w-full' style={{ paddingLeft: `${paddingLeftRem}rem` }}>
                <ArticleSidebarItem article={article} knowledgeBaseId={knowledgeBaseId} />
              </div>
              {hasChildren ? (
                <div className='relative'>
                  <ArticleTreeSection
                    articles={article.children}
                    level={level}
                    knowledgeBaseId={knowledgeBaseId}
                    articleOpenStates={articleOpenStates}
                    toggleArticleOpen={toggleArticleOpen}
                  />
                  <ArticleInsertLine
                    article={article}
                    knowledgeBaseId={knowledgeBaseId}
                    mode='after-group'
                  />
                </div>
              ) : null}
            </HeaderGroupHighlight>
          )
        }

        const isOpen = articleOpenStates[article.id] || false

        return (
          <div key={article.id} className='w-full' style={{ paddingLeft: `${paddingLeftRem}rem` }}>
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
          </div>
        )
      })}
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
