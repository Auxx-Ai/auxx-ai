// apps/web/src/components/kb/ui/sidebar/kb-tab-strip.tsx
'use client'

import { ArticleKind } from '@auxx/database/enums'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@auxx/ui/components/context-menu'
import { TabStrip } from '@auxx/ui/components/tab-strip'
import { toastError } from '@auxx/ui/components/toast'
import { generateKeyBetween } from '@auxx/utils'
import { EyeOff, Link2, Pencil, Send, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { useArticleList } from '../../hooks/use-article-list'
import { useArticleMutations } from '../../hooks/use-article-mutations'
import { usePublishWithConfirm } from '../../hooks/use-publish-with-confirm'
import { type ArticleMeta, getArticleStoreState } from '../../store/article-store'
import { TabSlugDialog } from './tab-slug-dialog'

interface KBTabStripProps {
  knowledgeBaseId: string
  activeTabId: string | null
  onTabChange: (tabId: string) => void
}

/**
 * Horizontal tab strip rendered at the top of `KBArticlesPanel`. Thin KB wrapper
 * over the shared `<TabStrip>`: it owns persistence (create/rename/reorder via
 * tRPC + the article store) and the per-tab context menu (rename / slug /
 * publish / delete). The strip handles the dnd, inline rename, and pending-pill
 * add UI.
 */
export function KBTabStrip({ knowledgeBaseId, activeTabId, onTabChange }: KBTabStripProps) {
  const articles = useArticleList(knowledgeBaseId)
  const tabs = useMemo(
    () =>
      articles
        .filter((a) => a.articleKind === 'tab')
        .sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0)),
    [articles]
  )

  const { createArticle, renameArticle } = useArticleMutations(knowledgeBaseId)
  const moveMutation = api.kb.moveArticle.useMutation()
  const utils = api.useUtils()

  const handleAddTab = useCallback(
    async (title: string) => {
      // First tab in this KB? Adopt every existing root non-tab article into the
      // new tab so the user doesn't have to reorganize manually. The snapshot is
      // captured before the create call so concurrent additions aren't pulled
      // in. Best-effort loop: a mid-loop failure leaves the rest at root and the
      // user can drag/retry.
      const orphans =
        articles.filter((a) => a.articleKind === 'tab').length === 0
          ? articles
              .filter((a) => a.parentId === null && a.articleKind !== 'tab')
              .sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0))
          : []

      const created = await createArticle({
        title,
        articleKind: ArticleKind.tab,
        parentId: null,
      })
      if (!created) return

      if (orphans.length > 0) {
        const store = getArticleStoreState()
        let prevKey: string | null = null
        for (const orphan of orphans) {
          try {
            const sortOrder = generateKeyBetween(prevKey, null)
            const move = { id: orphan.id, parentId: created.id, sortOrder }
            store.applyOptimisticMove(move)
            await moveMutation.mutateAsync({ knowledgeBaseId, ...move })
            store.confirmMove()
            prevKey = sortOrder
          } catch {
            store.rollbackMove()
          }
        }
        utils.kb.getArticles.invalidate({ knowledgeBaseId })
      }

      onTabChange(created.id)
    },
    [articles, createArticle, knowledgeBaseId, moveMutation, onTabChange, utils.kb.getArticles]
  )

  const handleReorder = useCallback(
    async (orderedIds: string[], movedId: string) => {
      const reordered = orderedIds
        .map((id) => tabs.find((t) => t.id === id))
        .filter((t): t is ArticleMeta => !!t)
      const newIndex = reordered.findIndex((t) => t.id === movedId)
      if (newIndex === -1) return

      const lo = newIndex > 0 ? reordered[newIndex - 1].sortOrder : null
      const hi = newIndex < reordered.length - 1 ? reordered[newIndex + 1].sortOrder : null

      let sortOrder: string
      try {
        sortOrder = generateKeyBetween(lo, hi)
      } catch {
        return
      }

      const adjacentId = newIndex > 0 ? reordered[newIndex - 1].id : reordered[newIndex + 1]?.id
      const position = newIndex > 0 ? 'after' : 'before'

      const store = getArticleStoreState()
      store.applyOptimisticMove({ id: movedId, parentId: null, sortOrder })
      try {
        await moveMutation.mutateAsync({
          knowledgeBaseId,
          id: movedId,
          parentId: null,
          adjacentId,
          position,
        })
        store.confirmMove()
        utils.kb.getArticles.invalidate({ knowledgeBaseId })
      } catch (error) {
        store.rollbackMove()
        toastError({
          title: "Couldn't reorder tab",
          description: error instanceof Error ? error.message : 'Unknown error occurred',
        })
      }
    },
    [tabs, moveMutation, knowledgeBaseId, utils.kb.getArticles]
  )

  return (
    <TabStrip
      tabs={tabs}
      activeTabId={activeTabId}
      onSelect={onTabChange}
      onRename={(id, title) => void renameArticle(id, { title })}
      onReorder={handleReorder}
      onAdd={handleAddTab}
      renderMenu={(tab, { startRename }) => (
        <KbTabMenu tab={tab} startRename={startRename} knowledgeBaseId={knowledgeBaseId} />
      )}
    />
  )
}

interface KbTabMenuProps {
  tab: ArticleMeta
  startRename: () => void
  knowledgeBaseId: string
}

/**
 * Per-tab context menu. Owns its own dialog hooks (confirm, publish-confirm,
 * slug) so they live inside a real component rather than the strip's render
 * prop.
 */
function KbTabMenu({ tab, startRename, knowledgeBaseId }: KbTabMenuProps) {
  const articles = useArticleList(knowledgeBaseId)
  const { deleteArticle } = useArticleMutations(knowledgeBaseId)
  const [confirm, ConfirmDialog] = useConfirm()
  const [slugOpen, setSlugOpen] = useState(false)
  const {
    requestPublish,
    requestUnpublish,
    ConfirmDialog: PublishConfirmDialog,
  } = usePublishWithConfirm(knowledgeBaseId)

  const handleDelete = useCallback(async () => {
    const hasChildren = articles.some((a) => a.parentId === tab.id)
    const ok = await confirm({
      title: hasChildren ? `Delete '${tab.title || 'Untitled'}'?` : 'Delete tab?',
      description: hasChildren
        ? 'Articles in this tab will be moved to the knowledge base root. This action cannot be undone.'
        : 'The tab will be removed. This action cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!ok) return
    await deleteArticle(tab.id)
  }, [articles, confirm, deleteArticle, tab.id, tab.title])

  return (
    <>
      <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
        <ContextMenuItem onSelect={startRename}>
          <Pencil /> Rename
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => setSlugOpen(true)}>
          <Link2 /> Update slug
        </ContextMenuItem>
        <ContextMenuSeparator />
        {tab.isPublished ? (
          <ContextMenuItem onSelect={() => requestUnpublish(tab)}>
            <EyeOff /> Unpublish
          </ContextMenuItem>
        ) : (
          <ContextMenuItem onSelect={() => requestPublish(tab)}>
            <Send /> Publish
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={handleDelete} variant='destructive'>
          <Trash2 /> Delete tab
        </ContextMenuItem>
      </ContextMenuContent>
      <ConfirmDialog />
      <PublishConfirmDialog />
      <TabSlugDialog
        open={slugOpen}
        onOpenChange={setSlugOpen}
        tab={tab}
        knowledgeBaseId={knowledgeBaseId}
      />
    </>
  )
}
