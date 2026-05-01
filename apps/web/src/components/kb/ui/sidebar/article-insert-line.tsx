// apps/web/src/components/kb/ui/sidebar/article-insert-line.tsx
'use client'

import { ArticleKind } from '@auxx/database/enums'
import type { ArticleKind as ArticleKindType } from '@auxx/database/types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { getFullSlugPath } from '@auxx/ui/components/kb/utils'
import { cn } from '@auxx/ui/lib/utils'
import { useDroppable } from '@dnd-kit/core'
import { FileText, FolderClosed, Heading } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useArticleList } from '../../hooks/use-article-list'
import { AFTER_GROUP_SUFFIX } from '../../hooks/use-article-move'
import { useArticleMutations } from '../../hooks/use-article-mutations'
import type { ArticleTreeNode } from '../../store/article-store'

type InsertMode = 'sibling-after' | 'first-child' | 'after-group'

interface ArticleInsertLineProps {
  article: ArticleTreeNode
  knowledgeBaseId: string
  /**
   * `sibling-after` (default): new article becomes a sibling positioned right
   * after `article`. `first-child`: new article becomes the first child of
   * `article` — used when the row is an open category so the plus visually
   * lives above the first child and inserting matches that placement.
   * `after-group`: same insert behavior as `sibling-after` (creates a sibling
   * after `article`, which is the group's parent category), but the line is
   * constrained to the leftmost indent strip of the group so it doesn't
   * overlap the last child's own sibling-after line.
   */
  mode?: InsertMode
}

/**
 * Hover-revealed insert affordance along the bottom edge of a sidebar row.
 * Clicking the plus opens a kind picker (Page / Category / Section Header)
 * and creates the chosen article. Section Header is only offered when the
 * resulting parent would be the KB root or a tab — the same rule
 * `validateArticleKind` enforces server-side.
 */
export function ArticleInsertLine({
  article,
  knowledgeBaseId,
  mode = 'sibling-after',
}: ArticleInsertLineProps) {
  const router = useRouter()
  const articles = useArticleList(knowledgeBaseId)
  const { createArticle } = useArticleMutations(knowledgeBaseId)
  const [menuOpen, setMenuOpen] = useState(false)

  const isFirstChild = mode === 'first-child'
  const isAfterGroup = mode === 'after-group'

  // Drag drop target — only registers when this line is in after-group mode.
  // Picks up `<article-id>-after-group` collisions in `useArticleMove`'s
  // collisionDetection / handleDragOver, which translate to a sibling-after
  // move at the article's parent level. This makes "drop below the last
  // header" reachable even when no row exists below to hover.
  const { setNodeRef: dropRef, isOver: isDropOver } = useDroppable({
    id: `${article.id}${AFTER_GROUP_SUFFIX}`,
    data: { article, dropArea: 'after-group', articleId: article.id },
    disabled: !isAfterGroup,
  })

  // Resolved parent of the about-to-be-created article. Drives both the
  // create payload and the header-eligibility check.
  const resolvedParentId = isFirstChild ? article.id : (article.parentId ?? null)
  const resolvedParent = resolvedParentId
    ? articles.find((a) => a.id === resolvedParentId)
    : undefined
  const headerAllowed = resolvedParentId === null || resolvedParent?.articleKind === 'tab'

  const handleCreate = async (articleKind: ArticleKindType) => {
    let created: Awaited<ReturnType<typeof createArticle>>
    if (isFirstChild) {
      // The server only understands `adjacentTo` + position 'before'/'after'.
      // Translate "first child" into "before the current first child"; if the
      // container is empty, omit ordering and let the server append.
      const firstChild = articles
        .filter((a) => a.parentId === article.id)
        .sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0))[0]
      created = await createArticle(
        firstChild
          ? {
              parentId: article.id,
              adjacentTo: firstChild.id,
              position: 'before',
              articleKind,
            }
          : { parentId: article.id, articleKind }
      )
    } else {
      created = await createArticle({
        parentId: article.parentId,
        adjacentTo: article.id,
        position: 'after',
        articleKind,
      })
    }
    // Pages/categories navigate to the new article so the editor opens it.
    // Headers are organizational — stay on the current article.
    if (created && articleKind !== ArticleKind.header) {
      const path = `/app/kb/${knowledgeBaseId}/editor/~/${getFullSlugPath(created, [...articles, created])}?panel=articles`
      router.push(path)
    }
  }

  const containerStyle: React.CSSProperties = isAfterGroup
    ? { left: '0', width: '1.5rem' }
    : { left: 0, right: 0 }

  const triggerClass = cn(
    'peer absolute bottom-[-8px] z-1 inline-flex rounded-full p-1 hover:bg-blue-500 hover:text-white group-hover/line:opacity-100',
    isAfterGroup ? 'left-0' : 'left-[-8px]',
    menuOpen ? 'bg-blue-500 text-white opacity-100' : 'text-muted-foreground opacity-0'
  )

  return (
    <>
      {isAfterGroup && (
        <div
          ref={dropRef}
          className='pointer-events-none absolute -bottom-4 left-0 right-0 z-0 h-7'
        />
      )}
      <div
        className={
          isAfterGroup
            ? 'group/line peer/insertarea absolute -bottom-px z-10 h-[12px]'
            : 'group/line absolute -bottom-px z-10 h-[12px]'
        }
        style={containerStyle}>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type='button'
              className={triggerClass}
              aria-label='Add item'
              onClick={(e) => e.stopPropagation()}>
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
          </DropdownMenuTrigger>
          <DropdownMenuContent align='start' className='w-48'>
            <DropdownMenuItem onSelect={() => void handleCreate(ArticleKind.page)}>
              <FileText /> Page
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void handleCreate(ArticleKind.category)}>
              <FolderClosed /> Category
            </DropdownMenuItem>
            {headerAllowed && (
              <DropdownMenuItem onSelect={() => void handleCreate(ArticleKind.header)}>
                <Heading /> Section header
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {!isAfterGroup && (
          <div
            className={cn(
              'absolute bottom-0 left-0 right-0 h-[2px] peer-hover:bg-blue-500',
              menuOpen && 'bg-blue-500'
            )}
          />
        )}
      </div>
      {isAfterGroup && (
        <div
          className={cn(
            'pointer-events-none absolute -bottom-px left-0 right-0 h-[2px] peer-hover/insertarea:bg-blue-500',
            (menuOpen || isDropOver) && 'bg-blue-500'
          )}
        />
      )}
    </>
  )
}
