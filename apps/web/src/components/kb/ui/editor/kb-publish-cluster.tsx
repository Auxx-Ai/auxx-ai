// apps/web/src/components/kb/ui/editor/kb-publish-cluster.tsx
'use client'

import { hasUnpublishedSettings as hasUnpublished } from '@auxx/lib/kb/client'
import { Button } from '@auxx/ui/components/button'
import { ButtonGroup, ButtonGroupSeparator } from '@auxx/ui/components/button-group'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { ChevronDown, Globe, Lock, Settings, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useKnowledgeBaseMutations } from '~/components/kb/hooks/use-knowledge-base-mutations'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { type KnowledgeBase, selectDraftedSections } from '../../store/knowledge-base-store'
import { KBSitePublishDialog } from '../preview/kb-site-publish-dialog'

interface KBPublishClusterProps {
  kbId: string
}

const SECTION_LABELS: Record<string, string> = {
  identity: 'Brand',
  logos: 'Logos',
  theme: 'Theme',
  colors: 'Colors',
  modes: 'Modes',
  styling: 'Site styles',
  header: 'Header',
  footer: 'Footer',
}

/**
 * Publish lifecycle controls for a knowledge base. When live, renders a
 * segmented `[● Live | Publish changes · N | ▾]` group whose chevron menu
 * holds the pending-changes list, discard, visibility toggle, and unpublish.
 * Designed to live inside `MainPageHeader.action` so the editor's chrome owns
 * the publish UX in one place.
 */
export function KBPublishCluster({ kbId }: KBPublishClusterProps) {
  const [isPublishDialogOpen, setIsPublishDialogOpen] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()

  const { data: kb } = api.kb.byId.useQuery({ id: kbId })
  const publishMutation = api.kb.publishSite.useMutation()
  const unpublishMutation = api.kb.unpublishSite.useMutation()

  const { publishPendingSettings, discardSettingsDraft, isPublishingPending, isDiscarding } =
    useKnowledgeBaseMutations()

  const draftedKb = kb as KnowledgeBase | undefined
  const drafted = selectDraftedSections(draftedKb)
  const pendingCount = drafted.size
  const hasPending = hasUnpublished((draftedKb?.draftSettings as never) ?? null) || pendingCount > 0

  const handleSwitchVisibility = async (status: 'PUBLISHED' | 'UNLISTED') => {
    try {
      await publishMutation.mutateAsync({ id: kbId, status })
      utils.kb.byId.invalidate({ id: kbId })
      utils.kb.list.invalidate()
      toastSuccess({
        title: status === 'PUBLISHED' ? 'Knowledge base is public' : 'Knowledge base is unlisted',
      })
    } catch (error) {
      toastError({
        title: 'Failed to update visibility',
        description: error instanceof Error ? error.message : 'Unknown error occurred',
      })
    }
  }

  const handleUnpublish = async () => {
    const ok = await confirm({
      title: 'Unpublish site?',
      description:
        'The knowledge base will no longer be accessible at its public URL. You can republish at any time.',
      confirmText: 'Unpublish',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!ok) return
    try {
      await unpublishMutation.mutateAsync({ id: kbId })
      utils.kb.byId.invalidate({ id: kbId })
      utils.kb.list.invalidate()
      toastSuccess({ title: 'Knowledge base unpublished' })
    } catch (error) {
      toastError({
        title: 'Failed to unpublish',
        description: error instanceof Error ? error.message : 'Unknown error occurred',
      })
    }
  }

  const handlePublishPending = async () => {
    await publishPendingSettings(kbId)
  }

  const handleDiscardPending = async () => {
    const ok = await confirm({
      title: 'Discard pending changes?',
      description: 'All unpublished settings changes will be lost. This cannot be undone.',
      confirmText: 'Discard',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!ok) return
    await discardSettingsDraft(kbId)
  }

  const isPublished = kb?.publishStatus === 'PUBLISHED'
  const isUnlisted = kb?.publishStatus === 'UNLISTED'
  const isLive = isPublished || isUnlisted

  return (
    <>
      {!isLive ? (
        <Button
          className='rounded-md'
          size='sm'
          variant='outline'
          onClick={() => setIsPublishDialogOpen(true)}>
          Publish site
        </Button>
      ) : (
        <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
          <ButtonGroup>
            <Button
              size='sm'
              variant='outline'
              className='gap-2 border-r-0'
              onClick={() => setIsMenuOpen((prev) => !prev)}>
              <span className='inline-block size-2 rounded-full bg-emerald-500' />
              {isUnlisted ? 'Live · Unlisted' : 'Live'}
            </Button>
            {hasPending && (
              <>
                <ButtonGroupSeparator />
                <Button
                  size='sm'
                  variant='outline'
                  className='border-r-0'
                  onClick={handlePublishPending}
                  loading={isPublishingPending}
                  loadingText='Publishing…'>
                  {pendingCount > 0 ? `Publish changes · ${pendingCount}` : 'Publish changes'}
                </Button>
              </>
            )}
            <ButtonGroupSeparator />
            <DropdownMenuTrigger asChild>
              <Button size='sm' variant='outline' className='px-1.5' aria-label='Publish menu'>
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
          </ButtonGroup>
          <DropdownMenuContent align='end' className='w-64'>
            {hasPending && (
              <>
                <div className='px-2 py-1.5'>
                  <div className='mb-1 font-medium text-xs'>
                    {pendingCount === 1 ? '1 pending change' : `${pendingCount} pending changes`}
                  </div>
                  {drafted.size === 0 ? (
                    <p className='text-muted-foreground text-xs'>No drafted fields.</p>
                  ) : (
                    <ul className='space-y-0.5 text-muted-foreground text-xs'>
                      {Array.from(drafted).map((s) => (
                        <li key={s}>· {SECTION_LABELS[s] ?? s}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <DropdownMenuItem onClick={handleDiscardPending} disabled={isDiscarding}>
                  <Trash2 /> Discard changes
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={() => setIsPublishDialogOpen(true)}>
              <Settings /> Publish settings
            </DropdownMenuItem>
            {isPublished ? (
              <DropdownMenuItem onClick={() => handleSwitchVisibility('UNLISTED')}>
                <Lock /> Make unlisted
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => handleSwitchVisibility('PUBLISHED')}>
                <Globe /> Make public
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleUnpublish} variant='destructive'>
              <Trash2 /> Unpublish site
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <KBSitePublishDialog
        open={isPublishDialogOpen}
        onOpenChange={setIsPublishDialogOpen}
        kbId={kbId}
      />
      <ConfirmDialog />
    </>
  )
}
