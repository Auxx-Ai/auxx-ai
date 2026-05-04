// apps/web/src/components/kb/ui/sidebar/kb-switcher.tsx
'use client'

import { mergeDraftOverLive } from '@auxx/lib/kb/client'
import { FeatureKey } from '@auxx/lib/permissions/client'
import { Avatar, AvatarFallback } from '@auxx/ui/components/avatar'
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from '@auxx/ui/components/dropdown-menu'
import { Book, Plus } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useMemo, useState } from 'react'
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
  const { createKnowledgeBase, isCreating } = useKnowledgeBaseMutations()

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

  return (
    <>
      <KnowledgeBaseDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onSubmit={handleCreateSubmit}
        isSubmitting={isCreating}
        mode='create'
      />

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
      <DropdownMenuRadioGroup value={activeKBId ?? ''} onValueChange={handleClickKnowledgeBase}>
        {isLoading ? (
          <DropdownMenuItem disabled>Loading...</DropdownMenuItem>
        ) : knowledgeBases.length > 0 ? (
          knowledgeBases.map((kb) => {
            const merged = mergeDraftOverLive(kb as Record<string, unknown>) as typeof kb
            return (
              <DropdownMenuRadioItem value={kb.id} key={kb.id} className='gap-2 p-2'>
                <div className='flex size-6 items-center justify-center rounded-sm border'>
                  <Book className='size-4 shrink-0' />
                </div>
                {merged.name}
              </DropdownMenuRadioItem>
            )
          })
        ) : (
          <DropdownMenuItem disabled>No knowledge bases found</DropdownMenuItem>
        )}
      </DropdownMenuRadioGroup>
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
