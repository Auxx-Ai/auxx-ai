// apps/web/src/components/kb/ui/landing/create-knowledge-base-button.tsx
'use client'

import { FeatureKey, PermissionKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import { Kbd } from '@auxx/ui/components/kbd'
import { useHotkey } from '@tanstack/react-hotkeys'
import { Book, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { CommandAction, CommandContext } from '~/components/kbar/contextual'
import { useCommandPaletteStore } from '~/components/kbar/store'
import { LimitReachedDialog } from '~/components/subscriptions/limit-reached-dialog'
import { useAccess } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'
import { useKnowledgeBaseMutations } from '../../hooks/use-knowledge-base-mutations'
import {
  KnowledgeBaseDialog,
  type KnowledgeBaseFormValues,
} from '../dialogs/kb-knowledge-base-dialog'

/**
 * The "Create Knowledge Base" action — lifted out of `ArticlesView` so the landing
 * tab shell can own the header action (the Articles tab shows this; Sources shows
 * the Connect Source button). Encapsulates the create dialog, the plan-limit gate,
 * and the post-create redirect into the new KB's editor.
 */
/**
 * @param registerShortcut - When true, binds the page-local `N` shortcut, shows
 *   the `<Kbd>` hint, and contributes the cmd+k action. Set only on the shell's
 *   header instance so empty-state copies don't double-register.
 */
export function CreateKnowledgeBaseButton({
  registerShortcut = false,
}: {
  registerShortcut?: boolean
} = {}) {
  const router = useRouter()
  const [isCreateKBOpen, setIsCreateKBOpen] = useState(false)
  const [limitDialogOpen, setLimitDialogOpen] = useState(false)
  const { can } = useAccess()
  const { createKnowledgeBase, isCreating } = useKnowledgeBaseMutations()

  const { isAtLimit, getLimit } = useFeatureFlags()
  // The /app/kb route doesn't hydrate the KB store, so read the count straight
  // from kb.list (warmed server-side by page.tsx).
  const kbList = api.kb.list.useQuery(undefined, { staleTime: 5 * 60 * 1000 })
  const kbCount = kbList.data?.length ?? 0
  const atLimit = isAtLimit(FeatureKey.knowledgeBases, kbCount)
  const kbLimit = getLimit(FeatureKey.knowledgeBases)

  // No allowance on the current plan — gate creation behind an upgrade prompt.
  const handleCreateClick = useCallback(() => {
    if (atLimit) {
      setLimitDialogOpen(true)
    } else {
      setIsCreateKBOpen(true)
    }
  }, [atLimit])

  // Page-local shortcut: N opens the create-KB dialog (or the limit prompt).
  useHotkey('N', handleCreateClick, { enabled: registerShortcut })

  const handleCreateKB = useCallback(
    async (values: KnowledgeBaseFormValues) => {
      const created = await createKnowledgeBase({ name: values.name, slug: values.slug })
      if (created) {
        setIsCreateKBOpen(false)
        router.push(`/app/kb/${created.id}/editor`)
      }
    },
    [createKnowledgeBase, router]
  )

  // Members without the knowledge-base Full rung can't create — hide the trigger.
  if (!can(PermissionKey.knowledgeBaseManage)) return null

  return (
    <>
      {registerShortcut && (
        <CommandContext kind='page' label='Knowledge Bases'>
          <CommandAction
            label='Create knowledge base'
            icon='book-open'
            keywords='create knowledge base kb new'
            shortcut={['N']}
            priority={10}
            perform={() => {
              useCommandPaletteStore.getState().close()
              handleCreateClick()
            }}
          />
        </CommandContext>
      )}
      <Button size='sm' className='h-7 rounded-lg' onClick={handleCreateClick}>
        <Plus />
        Create Knowledge Base
        {registerShortcut && (
          <Kbd variant='default' size='sm'>
            N
          </Kbd>
        )}
      </Button>
      <KnowledgeBaseDialog
        open={isCreateKBOpen}
        onOpenChange={setIsCreateKBOpen}
        onSubmit={handleCreateKB}
        isSubmitting={isCreating}
        mode='create'
      />
      <LimitReachedDialog
        open={limitDialogOpen}
        onOpenChange={setLimitDialogOpen}
        icon={Book}
        title={
          kbLimit === 0 || kbLimit === false
            ? 'Knowledge Bases Not Available'
            : 'Knowledge Base Limit Reached'
        }
        description={
          kbLimit === 0 || kbLimit === false
            ? 'Creating knowledge bases isn’t included in your current plan. Upgrade to start building one.'
            : `You've reached the maximum of ${kbLimit} knowledge bases on your current plan.`
        }
      />
    </>
  )
}
