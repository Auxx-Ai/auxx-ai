// apps/web/src/components/agents/procedures/ui/procedure-publish-cluster.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { ButtonGroup, ButtonGroupSeparator } from '@auxx/ui/components/button-group'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { useNavStack } from '@auxx/ui/components/nav-stack'
import { Tooltip, TooltipContent, TooltipTrigger } from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronDown, History, Send, Trash2, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { useProcedure } from '../hooks/use-procedure'
import { useProcedureMutations } from '../hooks/use-procedure-mutations'
import { ProcedureVersionsDialog } from './procedure-versions-dialog'

interface ProcedurePublishClusterProps {
  procedureId: string
  /** Bumped after revert/discard so the editor canvas remounts onto the new draft. */
  onReload?: () => void
}

/**
 * The procedure publish cluster — a trimmed `article-publish-cluster`. Derives a
 * three-state status pill (Draft / Live / Live·unsaved) from `meta.activeVersionId`
 * + `meta.hasUnpublishedChanges` and offers Publish / Publish-changes / Discard,
 * with a `⌄` menu for Version history + Delete (org-wide, blast-radius confirm).
 * No archive / unpublish / aiEnabled — procedures have a simpler lifecycle.
 */
export function ProcedurePublishCluster({ procedureId, onReload }: ProcedurePublishClusterProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isVersionsOpen, setIsVersionsOpen] = useState(false)
  const [confirm, ConfirmDialog] = useConfirm()
  const { pop } = useNavStack()
  const utils = api.useUtils()

  const { meta } = useProcedure(procedureId)
  const { publish, discardDraft, deleteProcedure, isPublishing, isDiscarding, isDeleting } =
    useProcedureMutations()

  const isPublished = !!meta?.activeVersionId
  const hasUnsaved = !!meta?.hasUnpublishedChanges
  const whenToUseEmpty = (meta?.whenToUse ?? '').trim() === ''

  const dotClass = isPublished ? (hasUnsaved ? 'bg-amber-500' : 'bg-emerald-500') : 'bg-slate-400'
  const pillLabel = isPublished ? 'Live' : 'Draft'

  const handleDiscard = async () => {
    const ok = await confirm({
      title: 'Discard unsaved changes?',
      description: 'Your draft reverts to the live version. This cannot be undone.',
      confirmText: 'Discard',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!ok) return
    const success = await discardDraft(procedureId)
    if (success) onReload?.()
  }

  const handleDelete = async () => {
    const count = await utils.procedure.agentUsageCount.fetch({ id: procedureId })
    const ok = await confirm({
      title: `Delete ${meta?.name ?? 'procedure'}?`,
      description:
        count > 0
          ? `It's used by ${count} agent${count === 1 ? '' : 's'} and will be removed from all of them. This cannot be undone.`
          : "It isn't used by any agent. This cannot be undone.",
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!ok) return
    const success = await deleteProcedure(procedureId)
    if (success) pop()
  }

  const publishLabel = 'Publish'
  const publishBusy = isPublishing || isDeleting

  return (
    <>
      <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
        <ButtonGroup className='shrink-0'>
          <Button
            size='xs'
            variant='outline'
            className='gap-2 border-r-0'
            onClick={() => setIsMenuOpen((prev) => !prev)}>
            <span className={cn('inline-block size-2 rounded-full', dotClass)} />
            {pillLabel}
          </Button>

          {(!isPublished || hasUnsaved) && (
            <>
              <ButtonGroupSeparator />
              {whenToUseEmpty ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className='inline-flex'>
                      <Button
                        size='xs'
                        variant='outline'
                        className='rounded-none border-x-0'
                        disabled>
                        <Send /> {publishLabel}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Set "when to use" before publishing</TooltipContent>
                </Tooltip>
              ) : (
                <Button
                  size='xs'
                  variant='outline'
                  className='border-r-0'
                  loading={isPublishing}
                  loadingText='Publishing…'
                  onClick={() => void publish(procedureId)}>
                  <Send /> {publishLabel}
                </Button>
              )}
            </>
          )}

          {isPublished && hasUnsaved && (
            <>
              <ButtonGroupSeparator />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size='xs'
                    variant='outline'
                    className='border-r-0 px-1.5'
                    loading={isDiscarding}
                    loadingText=''
                    onClick={handleDiscard}
                    aria-label='Discard changes'>
                    <Undo2 />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Discard changes</TooltipContent>
              </Tooltip>
            </>
          )}

          <ButtonGroupSeparator />
          <DropdownMenuTrigger asChild>
            <Button
              size='xs'
              variant='outline'
              className='px-1.5'
              disabled={publishBusy}
              aria-label='Publish menu'>
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
        </ButtonGroup>

        <DropdownMenuContent align='end' className='w-56'>
          <DropdownMenuItem onClick={() => setIsVersionsOpen(true)}>
            <History /> Version history
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleDelete} variant='destructive'>
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ProcedureVersionsDialog
        open={isVersionsOpen}
        onOpenChange={setIsVersionsOpen}
        procedureId={procedureId}
        onReload={onReload}
      />
      <ConfirmDialog />
    </>
  )
}
