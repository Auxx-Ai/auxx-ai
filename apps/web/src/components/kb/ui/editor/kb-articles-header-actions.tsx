// apps/web/src/components/kb/ui/editor/kb-articles-header-actions.tsx
'use client'

import { ArticleKind } from '@auxx/database/enums'
import type { ArticleKind as ArticleKindType } from '@auxx/database/types'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { getFullSlugPath } from '@auxx/ui/components/kb/utils'
import { toastError } from '@auxx/ui/components/toast'
import { FileText, FolderClosed, Heading, Plus, Settings, Upload } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useRef } from 'react'
import { useActiveTabId } from '../../hooks/use-active-tab'
import { useArticleList } from '../../hooks/use-article-list'
import { useArticleMutations } from '../../hooks/use-article-mutations'

interface KBArticlesHeaderActionsProps {
  knowledgeBaseId: string
}

export function KBArticlesHeaderActions({ knowledgeBaseId }: KBArticlesHeaderActionsProps) {
  const router = useRouter()
  const articles = useArticleList(knowledgeBaseId)
  const activeTabId = useActiveTabId(knowledgeBaseId)
  const { createArticle, isCreating } = useArticleMutations(knowledgeBaseId)
  const importInputRef = useRef<HTMLInputElement>(null)

  const basePath = `/app/kb/${knowledgeBaseId}`

  const handleCreateInTab = useCallback(
    async (articleKind: ArticleKindType = ArticleKind.page) => {
      if (!activeTabId) return
      const created = await createArticle({ parentId: activeTabId, articleKind })
      if (created && articleKind !== ArticleKind.header) {
        const path = `${basePath}/editor/~/${getFullSlugPath(created, [...articles, created])}?panel=articles`
        router.push(path)
      }
    },
    [activeTabId, articles, basePath, createArticle, router]
  )

  const handleImportMarkdown = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0 || !activeTabId) return
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
            parentId: activeTabId,
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
    [activeTabId, createArticle]
  )

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant='ghost' size='icon-sm' className='h-6 w-6' disabled={isCreating}>
            <Plus />
            <span className='sr-only'>Add Page or Settings</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-48'>
          <DropdownMenuItem
            disabled={isCreating || !activeTabId}
            onSelect={() => void handleCreateInTab(ArticleKind.page)}>
            <FileText className='mr-2 h-4 w-4' /> Page
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isCreating || !activeTabId}
            onSelect={() => void handleCreateInTab(ArticleKind.category)}>
            <FolderClosed className='mr-2 h-4 w-4' /> Category
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isCreating || !activeTabId}
            onSelect={() => void handleCreateInTab(ArticleKind.header)}>
            <Heading className='mr-2 h-4 w-4' /> Section header
          </DropdownMenuItem>
          <DropdownMenuSeparator />
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
    </>
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
