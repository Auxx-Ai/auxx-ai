// apps/web/src/components/kb/ui/sidebar/article-insert-line.tsx
'use client'

import { getFullSlugPath } from '@auxx/ui/components/kb/utils'
import { useRouter } from 'next/navigation'
import { useArticleList } from '../../hooks/use-article-list'
import { useArticleMutations } from '../../hooks/use-article-mutations'
import type { ArticleTreeNode } from '../../store/article-store'

type InsertMode = 'sibling-after' | 'first-child'

interface ArticleInsertLineProps {
  article: ArticleTreeNode
  knowledgeBaseId: string
  /**
   * `sibling-after` (default): new article becomes a sibling positioned right
   * after `article`. `first-child`: new article becomes the first child of
   * `article` — used when the row is an open category so the plus visually
   * lives above the first child and inserting matches that placement.
   */
  mode?: InsertMode
}

/**
 * Hover-revealed insert affordance along the bottom edge of a sidebar row.
 * Clicking the plus creates a new article and navigates to it. Shared
 * between {@link ArticleSidebarItem} and ArticleHeaderItem so authors can
 * drop a page in between any two rows.
 */
export function ArticleInsertLine({
  article,
  knowledgeBaseId,
  mode = 'sibling-after',
}: ArticleInsertLineProps) {
  const router = useRouter()
  const articles = useArticleList(knowledgeBaseId)
  const { createArticle } = useArticleMutations(knowledgeBaseId)

  const isFirstChild = mode === 'first-child'

  const handleAdd = async () => {
    const created = isFirstChild
      ? await createArticle({ parentId: article.id, position: 'first_child' })
      : await createArticle({
          parentId: article.parentId,
          adjacentTo: article.id,
          position: 'after',
        })
    if (created) {
      const path = `/app/kb/${knowledgeBaseId}/editor/~/${getFullSlugPath(created, [...articles, created])}?panel=articles`
      router.push(path)
    }
  }

  return (
    <div
      className='group/line absolute -bottom-px right-0 z-10 h-[12px]'
      style={isFirstChild ? { left: '1rem' } : { left: '0rem' }}>
      <button
        onClick={handleAdd}
        className='peer absolute bottom-[-8px] left-[-8px] z-1 inline-flex rounded-full p-1 text-muted-foreground opacity-0 hover:bg-blue-500 hover:text-white group-hover/line:opacity-100 '
        type='button'
        aria-label='Add item after'>
        <svg
          xmlns='http://www.w3.org/2000/svg'
          fill='none'
          viewBox='0 0 16 16'
          preserveAspectRatio='xMidYMid meet'
          width='10'
          height='10'
          style={{ verticalAlign: 'middle' }}>
          <path
            fill='currentColor'
            d='M8.6 3a.6.6 0 0 0-1.2 0v4.4H3a.6.6 0 0 0 0 1.2h4.4V13a.6.6 0 1 0 1.2 0V8.6H13a.6.6 0 1 0 0-1.2H8.6V3Z'
          />
        </svg>
      </button>
      <div className='absolute bottom-0 left-0 right-0 h-[2px] peer-hover:bg-blue-500' />
    </div>
  )
}
