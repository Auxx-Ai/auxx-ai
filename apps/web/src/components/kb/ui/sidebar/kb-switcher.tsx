// apps/web/src/components/kb/ui/sidebar/kb-switcher.tsx
'use client'

import { mergeDraftOverLive } from '@auxx/lib/kb/client'
import { FeatureKey } from '@auxx/lib/permissions/client'
import { Avatar, AvatarFallback } from '@auxx/ui/components/avatar'
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@auxx/ui/components/dropdown-menu'
import { Book, Check, Plus, Trash2 } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useMemo, useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { useActiveKnowledgeBaseId } from '../../hooks/use-knowledge-base'
import { useKnowledgeBaseMutations } from '../../hooks/use-knowledge-base-mutations'
import { useKnowledgeBases } from '../../hooks/use-knowledge-bases'
import {
  KnowledgeBaseDialog,
  type KnowledgeBaseFormValues,
} from '../dialogs/kb-knowledge-base-dialog'

function getInitials(name?: string): string {
  if (!name) return 'KB'
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .substring(0, 2)
}

/**
 * Body of the KB switcher dropdown menu — list of knowledge bases plus an
 * "Add Knowledge Base" entry. Designed to be mounted inside any
 * `<DropdownMenuContent>` (the breadcrumb dropdown in the editor header, or
 * any other host).
 */
export function KBSwitcherDropdownContent() {
  const router = useRouter()
  const params = useSearchParams()
  const [showCreateDialog, setShowCreateDialog] = useState(false)

  const { knowledgeBases, isLoading } = useKnowledgeBases()
  const activeKBId = useActiveKnowledgeBaseId()
  const { createKnowledgeBase, isCreating, deleteKnowledgeBase } = useKnowledgeBaseMutations()
  const [confirm, ConfirmDialog] = useConfirm()

  const { getLimit } = useFeatureFlags()
  const kbLimit = getLimit(FeatureKey.knowledgeBases)

  const canCreateKB = useMemo(() => {
    if (kbLimit === null || kbLimit === false || kbLimit === 0) return false
    if (kbLimit === '+' || kbLimit === true) return true
    if (typeof kbLimit === 'number') return knowledgeBases.length < kbLimit
    return true
  }, [kbLimit, knowledgeBases.length])

  const activeKB = useMemo(() => {
    const kb = knowledgeBases.find((k) => k.id === activeKBId)
    return kb ? (mergeDraftOverLive(kb as Record<string, unknown>) as typeof kb) : kb
  }, [knowledgeBases, activeKBId])

  const handleClickKnowledgeBase = (knowledgeBaseId: string) => {
    const panel = params?.get('panel') ?? 'general'
    router.push(`/app/kb/${knowledgeBaseId}/editor?panel=${panel}`)
  }

  const handleCreateSubmit = async (values: KnowledgeBaseFormValues) => {
    const created = await createKnowledgeBase({
      name: values.name,
      slug: values.slug,
    })
    if (created) {
      setShowCreateDialog(false)
      router.push(`/app/kb/${created.id}/editor`)
    }
  }

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirm({
      title: 'Delete knowledge base?',
      description: `"${name}" and all of its docs will be permanently deleted. This action cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!ok) return
    const success = await deleteKnowledgeBase(id)
    if (success && id === activeKBId) {
      const next = knowledgeBases.find((k) => k.id !== id)
      router.push(next ? `/app/kb/${next.id}/editor` : '/app/kb')
    }
  }

  return (
    <>
      <KnowledgeBaseDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onSubmit={handleCreateSubmit}
        isSubmitting={isCreating}
        mode='create'
      />
      <ConfirmDialog />

      <DropdownMenuLabel className='p-0 font-normal'>
        <div className='flex items-center gap-2 px-1 py-1.5 text-left text-sm'>
          <Avatar className='h-8 w-8 rounded-lg'>
            <AvatarFallback className='rounded-lg bg-primary/10 text-primary'>
              {activeKB ? getInitials(activeKB.name) : 'KB'}
            </AvatarFallback>
          </Avatar>
          <div className='grid flex-1 text-left text-sm leading-tight'>
            <span className='truncate font-semibold'>
              {isLoading ? 'Loading...' : activeKB?.name || 'Knowledge Base'}
            </span>
            <span className='truncate text-xs'>
              {activeKB?.publishStatus === 'PUBLISHED'
                ? 'Public'
                : activeKB?.publishStatus === 'UNLISTED'
                  ? 'Unlisted'
                  : 'Private'}
            </span>
          </div>
        </div>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      {isLoading ? (
        <DropdownMenuItem disabled>Loading...</DropdownMenuItem>
      ) : knowledgeBases.length > 0 ? (
        knowledgeBases.map((kb) => {
          const merged = mergeDraftOverLive(kb as Record<string, unknown>) as typeof kb
          const isActive = kb.id === activeKBId
          return (
            <DropdownMenuItem
              key={kb.id}
              onSelect={() => handleClickKnowledgeBase(kb.id)}
              className='group/kb-item h-7 cursor-pointer'>
              <div className='flex items-center justify-between w-full'>
                <div className='flex items-center gap-2 min-w-0'>
                  <div className='flex size-5 shrink-0 items-center justify-center rounded-sm border'>
                    <Book className='size-3 shrink-0' />
                  </div>
                  <span className='truncate'>{merged.name}</span>
                </div>
                <div className='flex items-center gap-1 shrink-0'>
                  <button
                    type='button'
                    aria-label={`Delete ${merged.name}`}
                    className='hidden group-hover/kb-item:flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-bad-100 hover:text-bad-500'
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      handleDelete(kb.id, merged.name ?? 'this knowledge base')
                    }}>
                    <Trash2 className='size-3' />
                  </button>
                  {isActive && (
                    <div className='rounded-full size-4 bg-info flex items-center justify-center border border-blue-800'>
                      <Check className='size-2.5! text-white' strokeWidth={4} />
                    </div>
                  )}
                </div>
              </div>
            </DropdownMenuItem>
          )
        })
      ) : (
        <DropdownMenuItem disabled>No knowledge bases found</DropdownMenuItem>
      )}
      {canCreateKB && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault()
              setShowCreateDialog(true)
            }}>
            <Plus />
            Add Knowledge Base
          </DropdownMenuItem>
        </>
      )}
    </>
  )
}
