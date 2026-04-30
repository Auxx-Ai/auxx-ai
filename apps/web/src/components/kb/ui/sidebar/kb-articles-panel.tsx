// apps/web/src/components/kb/ui/sidebar/kb-articles-panel.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { EntityIcon, getIcon } from '@auxx/ui/components/icons'
import { getFullSlugPath } from '@auxx/ui/components/kb/utils'
import { toastError } from '@auxx/ui/components/toast'
import { closestCorners, DndContext, DragOverlay } from '@dnd-kit/core'
import { restrictToVerticalAxis, restrictToWindowEdges } from '@dnd-kit/modifiers'
import { Archive, Loader2, Plus, Settings, Upload } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useArticleList, useIsArticleListLoaded } from '../../hooks/use-article-list'
import { useArticleMove } from '../../hooks/use-article-move'
import { useArticleMutations } from '../../hooks/use-article-mutations'
import type { ArticleMeta, ArticleTreeNode } from '../../store/article-store'
import { ArticleTreeSection } from './article-tree-section'

interface KBArticlesPanelProps {
  knowledgeBaseId: string
}

export function KBArticlesPanel({ knowledgeBaseId }: KBArticlesPanelProps) {
  const pathname = usePathname() ?? ''
  const router = useRouter()

  const articles = useArticleList(knowledgeBaseId)
  const hasLoaded = useIsArticleListLoaded(knowledgeBaseId)
  const { createArticle, isCreating } = useArticleMutations(knowledgeBaseId)

  const archivedKey = `kb-${knowledgeBaseId}-show-archived`
  const [showArchived, setShowArchived] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem(archivedKey) === 'true'
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem(archivedKey, showArchived ? 'true' : 'false')
  }, [showArchived, archivedKey])

  const storageKey = `kb-${knowledgeBaseId}-openStates`
  const [articleOpenStates, setArticleOpenStates] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {}
    try {
      const stored = localStorage.getItem(storageKey)
      return stored ? JSON.parse(stored) : {}
    } catch {
      return {}
    }
  })

  useEffect(() => {
    if (typeof window !== 'undefined' && Object.keys(articleOpenStates).length > 0) {
      localStorage.setItem(storageKey, JSON.stringify(articleOpenStates))
    }
  }, [articleOpenStates, storageKey])

  const basePath = `/app/kb/${knowledgeBaseId}`

  const toggleArticleOpen = useCallback((articleId: string) => {
    setArticleOpenStates((prev) => ({ ...prev, [articleId]: !prev[articleId] }))
  }, [])

  const { handleDragStart, handleDragOver, handleDragEnd, activeArticle, sensors, articleTree } =
    useArticleMove({ knowledgeBaseId, articleOpenStates, setArticleOpenStates })

  const archivedCount = useMemo(
    () => articles.filter((a) => a.status === 'ARCHIVED').length,
    [articles]
  )

  const visibleTree = useMemo(() => {
    if (showArchived) return articleTree
    const stripArchived = (nodes: ArticleTreeNode[]): ArticleTreeNode[] =>
      nodes
        .filter((n) => n.status !== 'ARCHIVED')
        .map((n) => ({ ...n, children: stripArchived(n.children ?? []) }))
    return stripArchived(articleTree)
  }, [articleTree, showArchived])

  // Find the article matching the current pathname so we can expand its parents.
  const findActiveArticle = useCallback((): ArticleMeta | undefined => {
    if (!articles || articles.length === 0) return undefined
    const editorPrefix = `${basePath}/editor/~/`
    const articlesPrefix = `${basePath}/articles/`
    let slug = ''
    if (pathname.startsWith(editorPrefix)) {
      slug = pathname.slice(editorPrefix.length).split('?')[0]
    } else if (pathname.startsWith(articlesPrefix)) {
      slug = pathname.slice(articlesPrefix.length).split('?')[0]
    }
    if (!slug) return undefined
    const slugParts = slug.split('/')
    return articles.find((article) => {
      if (article.slug === slug && !article.parentId) return true
      if (slugParts.length > 1 && slugParts[slugParts.length - 1] === article.slug) {
        let cursor: ArticleMeta | undefined = article
        for (let i = slugParts.length - 1; i >= 0; i--) {
          if (!cursor || cursor.slug !== slugParts[i]) return false
          if (i > 0) {
            cursor = articles.find((a) => a.id === cursor!.parentId)
          }
        }
        return true
      }
      return false
    })
  }, [articles, pathname, basePath])

  // Auto-expand parents of the active article whenever pathname changes.
  useEffect(() => {
    if (!articles || articles.length === 0) return
    const active = findActiveArticle()
    if (!active) return

    const parentIds: string[] = []
    let cursor = active.parentId
    while (cursor) {
      parentIds.push(cursor)
      const parent = articles.find((a) => a.id === cursor)
      if (!parent) break
      cursor = parent.parentId
    }
    if (parentIds.length === 0) return

    setArticleOpenStates((prev) => {
      const next = { ...prev }
      for (const id of parentIds) next[id] = true
      return next
    })
  }, [articles, findActiveArticle])

  const handleCreateRoot = useCallback(async () => {
    const created = await createArticle({})
    if (created) {
      const path = `${basePath}/editor/~/${getFullSlugPath(created, [...articles, created])}?tab=articles`
      router.push(path)
    }
  }, [articles, basePath, createArticle, router])

  const importInputRef = useRef<HTMLInputElement>(null)

  const handleImportMarkdown = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return
      const { mdToBlocks, parseFrontmatter } = await import('@auxx/lib/kb/markdown')
      const failures: string[] = []
      for (const file of Array.from(files)) {
        try {
          const text = await file.text()
          const { fields } = parseFrontmatter(text)
          const doc = mdToBlocks(text)
          const inferredTitle =
            fields.title ?? extractFirstHeading(doc) ?? file.name.replace(/\.md$/i, '')
          await createArticle({
            title: inferredTitle,
            slug: fields.slug,
            description: fields.description,
            contentJson: doc,
          })
        } catch (error) {
          console.error('Markdown import failed', file.name, error)
          failures.push(file.name)
        }
      }
      if (failures.length > 0) {
        toastError({
          title: `Failed to import ${failures.length} file${failures.length === 1 ? '' : 's'}`,
          description: failures.join(', '),
        })
      }
    },
    [createArticle]
  )

  if (!hasLoaded) {
    return (
      <div className='flex items-center justify-center py-8'>
        <Loader2 className='h-6 w-6 animate-spin text-muted-foreground' />
      </div>
    )
  }

  if (articles.length === 0) {
    return (
      <div className='flex flex-col items-center justify-center p-8 text-center'>
        <p className='mb-4 text-muted-foreground'>No articles yet.</p>
        <Button
          variant='default'
          size='sm'
          className='gap-1'
          onClick={handleCreateRoot}
          loading={isCreating}>
          <Plus />
          Create First Article
        </Button>
      </div>
    )
  }

  return (
    <div className='relative space-y-1 p-1'>
      <div className='mb-1 flex items-center justify-between px-2'>
        <h3 className='text-xs font-medium uppercase text-muted-foreground'>Articles</h3>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant='ghost' size='icon-sm' className='h-6 w-6' disabled={isCreating}>
              <Plus />
              <span className='sr-only'>Add Page or Settings</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuItem disabled={isCreating} onClick={handleCreateRoot}>
              {isCreating ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className='mr-2 h-4 w-4' /> Add Page
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => importInputRef.current?.click()}>
              <Upload className='mr-2 h-4 w-4' /> Import .md
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`${basePath}/settings`}>
                <Settings className='mr-2 h-4 w-4' />
                KB Settings
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <input
          ref={importInputRef}
          type='file'
          accept='.md,text/markdown'
          multiple
          className='hidden'
          onChange={(e) => {
            void handleImportMarkdown(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        modifiers={[restrictToVerticalAxis, restrictToWindowEdges]}>
        <ArticleTreeSection
          articles={visibleTree}
          knowledgeBaseId={knowledgeBaseId}
          articleOpenStates={articleOpenStates}
          toggleArticleOpen={toggleArticleOpen}
        />

        <DragOverlay
          dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}
          style={{ cursor: 'grabbing' }}>
          {activeArticle ? (
            <div
              className='pointer-events-none rounded-md border bg-background px-3 py-2 opacity-80 shadow-md'
              style={{ maxWidth: '280px' }}>
              <div className='flex items-center space-x-2'>
                <span className='shrink-0 text-muted-foreground'>
                  {activeArticle.emoji && getIcon(activeArticle.emoji) ? (
                    <EntityIcon iconId={activeArticle.emoji} variant='bare' size='sm' />
                  ) : activeArticle.isCategory ? (
                    '📁'
                  ) : (
                    '📄'
                  )}
                </span>
                <span className='truncate font-medium'>{activeArticle.title || 'Untitled'}</span>
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <div className='mt-2 px-2'>
        <Button
          className='w-full justify-start text-muted-foreground'
          variant='ghost'
          size='sm'
          disabled={isCreating}
          onClick={handleCreateRoot}>
          {isCreating ? (
            <>
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              Creating...
            </>
          ) : (
            <>
              <Plus className='mr-2 h-4 w-4' /> Add Page
            </>
          )}
        </Button>
        {archivedCount > 0 && (
          <Button
            className='mt-1 w-full justify-start text-muted-foreground'
            variant='ghost'
            size='sm'
            onClick={() => setShowArchived((v) => !v)}>
            <Archive className='mr-2 h-4 w-4' />
            {showArchived ? `Hide archived (${archivedCount})` : `Show archived (${archivedCount})`}
          </Button>
        )}
      </div>
    </div>
  )
}

interface MaybeDoc {
  content?: { attrs?: { blockType?: string }; content?: { type: string; text?: string }[] }[]
}

function extractFirstHeading(doc: MaybeDoc): string | undefined {
  for (const block of doc.content ?? []) {
    if (block?.attrs?.blockType !== 'heading') continue
    const text = (block.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('')
      .trim()
    if (text.length > 0) return text
  }
  return undefined
}
