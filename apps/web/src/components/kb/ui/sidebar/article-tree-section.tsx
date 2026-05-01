// apps/web/src/components/kb/ui/sidebar/article-tree-section.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { AnimatePresence, motion } from 'motion/react'
import type { ArticleTreeNode } from '../../store/article-store'
import { ArticleHeaderItem } from './article-header-item'
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
  // const paddingLeftRem = level * 1.125
  const paddingLeftRem = level === 0 ? 0 : 1.125

  return (
    <>
      {articles.map((article) => {
        const hasChildren = article.children && article.children.length > 0

        // Headers are presentational — uppercase label, always-open container,
        // no drag handle. Their children render at the same depth. Hover
        // exposes a 3-dot menu for rename/delete.
        if (article.articleKind === 'header') {
          return (
            <div
              key={article.id}
              className='w-full'
              style={{ paddingLeft: `${paddingLeftRem}rem` }}>
              <ArticleHeaderItem article={article} knowledgeBaseId={knowledgeBaseId} />
              {hasChildren ? (
                <ArticleTreeSection
                  articles={article.children}
                  level={level}
                  knowledgeBaseId={knowledgeBaseId}
                  articleOpenStates={articleOpenStates}
                  toggleArticleOpen={toggleArticleOpen}
                />
              ) : null}
            </div>
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
                    <div className='absolute bottom-0 left-[calc(0.5rem+8px)] top-0 z-0 w-px bg-border' />
                    <ArticleTreeSection
                      articles={article.children}
                      level={level + 1}
                      knowledgeBaseId={knowledgeBaseId}
                      articleOpenStates={articleOpenStates}
                      toggleArticleOpen={toggleArticleOpen}
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
