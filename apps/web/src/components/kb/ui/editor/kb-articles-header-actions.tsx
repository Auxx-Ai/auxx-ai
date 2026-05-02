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
import { toastError } from '@auxx/ui/components/toast'
import { FileText, FolderClosed, Heading, Link2, Plus, Upload } from 'lucide-react'
import { useCallback, useRef } from 'react'
import { useActiveArticle } from '../../hooks/use-active-article'
import { useActiveTabId } from '../../hooks/use-active-tab'
import { useArticleList } from '../../hooks/use-article-list'
import { useArticleMutations } from '../../hooks/use-article-mutations'
import { usePendingInsertStore } from '../../store/pending-insert-store'
import { inferCreateParent } from '../../utils/infer-create-parent'

interface KBArticlesHeaderActionsProps {
  knowledgeBaseId: string
}

export function KBArticlesHeaderActions({ knowledgeBaseId }: KBArticlesHeaderActionsProps) {
  const articles = useArticleList(knowledgeBaseId)
  const activeTabId = useActiveTabId(knowledgeBaseId)
  const activeArticle = useActiveArticle(knowledgeBaseId)
  const { createArticle, isCreating } = useArticleMutations(knowledgeBaseId)
  const setPending = usePendingInsertStore((s) => s.setPending)
  const importInputRef = useRef<HTMLInputElement>(null)

  const handleCreateInTab = useCallback(
    (articleKind: ArticleKindType = ArticleKind.page) => {
      // Tabs are optional — `activeTabId === null` means the KB has no tabs;
      // we create at the root. Headers may sit at root or under a tab.
      const parentId =
        articleKind === ArticleKind.header
          ? activeTabId
          : inferCreateParent(activeArticle, activeTabId, articles)
      setPending({ articleKind, parentId })
    },
    [activeArticle, activeTabId, articles, setPending]
  )

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
        <DropdownMenuContent
          align='end'
          className='w-48'
          onCloseAutoFocus={(e) => e.preventDefault()}>
          <DropdownMenuItem
            disabled={isCreating}
            onSelect={() => void handleCreateInTab(ArticleKind.page)}>
            <FileText /> Page
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isCreating}
            onSelect={() => void handleCreateInTab(ArticleKind.category)}>
            <FolderClosed /> Category
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isCreating}
            onSelect={() => void handleCreateInTab(ArticleKind.link)}>
            <Link2 /> Link
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isCreating}
            onSelect={() => void handleCreateInTab(ArticleKind.header)}>
            <Heading /> Section header
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => importInputRef.current?.click()}>
            <Upload /> Import .md
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
