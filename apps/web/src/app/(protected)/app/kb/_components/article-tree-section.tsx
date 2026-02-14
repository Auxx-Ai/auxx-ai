// src/app/(protected)/app/kb/_components/article-tree-section.tsx

import { cn } from '@auxx/ui/lib/utils'
// Assuming Article type is available from helpers or sidebar component
// import { Article } from './helpers' // Import Article type
// import ArticleSidebarItem from './article-sidebar-item'
import { AnimatePresence, motion } from 'motion/react'
import type React from 'react'
import ArticleSidebarItem from './article-sidebar-item'
import { useKnowledgeBase } from './kb-context'
import type { Article } from './kb-sidebar'

// No need for useArticleMove here anymore

/**
 * Props for the ArticleTreeSection component
 */
interface ArticleTreeSectionProps {
  /** The list of articles/categories at this level of the tree */
  articles: Article[]
  /** Current nesting level (for indentation) */
  level?: number
  /** Base path for generating links */
  basePath: string
  /** Record of which categories are open */
  articleOpenStates: Record<string, boolean>
  /** Callback to toggle category open state */
  toggleArticleOpen: (articleId: string) => void
  /** ID of the knowledge base */
  knowledgeBaseId: string // Keep for potential future use? Maybe pass to item?
  /** Current drop target info (passed down to items) */
  dropTarget?: { id: string; dropArea: string } | null
  /** Is any drag operation active globally? (passed down to items) */
  isDraggingAny?: boolean
}

/**
 * Renders a section of the article tree recursively.
 * Handles indentation and animation for expanding/collapsing categories.
 */
const ArticleTreeSection: React.FC<ArticleTreeSectionProps> = ({
  articles,
  level = 0,
  basePath, // Parent slug path is handled by context now
  articleOpenStates,
  toggleArticleOpen,
  knowledgeBaseId, // Pass down if needed by item actions
  dropTarget,
  isDraggingAny,
}) => {
  // Calculate padding for indentation based on nesting level
  // Using padding-left directly on the item container div now
  const paddingLeftRem = level * 1.125 // e.g., 18px per level (1.125 * 16px)

  return (
    // Use a fragment as the direct children are the items/motion divs
    <>
      {articles.map((article) => {
        // const isCategory = article.isCategory // Use the direct property
        const hasChildren = article.children && article.children.length > 0
        const isOpen = articleOpenStates[article.id] || false // Only categories can be open
        // console.log('isOpen', isOpen, hasChildren)
        return (
          <div key={article.id} className='w-full' style={{ paddingLeft: `${paddingLeftRem}rem` }}>
            {/* Render the individual sidebar item */}
            {/* Pass down necessary props: article data, open state, toggle handler, drop target info, drag state */}
            <ArticleSidebarItem
              article={article}
              isOpen={isOpen}
              onToggleOpen={toggleArticleOpen} // Only pass toggle for categories
              dropTarget={dropTarget} // Pass down for indicator rendering
              isDraggingAny={isDraggingAny} // Pass down for conditional rendering/styling
            />

            {/* Recursive Rendering for Children (if category is open) */}
            {hasChildren && (
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.15 }} // Faster animation
                    className={cn('relative overflow-hidden')} // Overflow hidden during animation
                  >
                    {/* Optional: Vertical connector line */}
                    <div className='absolute bottom-0 left-[calc(0.5rem+8px)] top-0 z-0 w-px bg-border'></div>

                    {/* Recursively render the next level */}
                    <ArticleTreeSection
                      articles={article.children || []}
                      level={level + 1} // Increment level for indentation
                      basePath={basePath}
                      articleOpenStates={articleOpenStates}
                      toggleArticleOpen={toggleArticleOpen}
                      knowledgeBaseId={knowledgeBaseId}
                      dropTarget={dropTarget} // Pass down drop target info
                      isDraggingAny={isDraggingAny} // Pass down global drag state
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

export default ArticleTreeSection
