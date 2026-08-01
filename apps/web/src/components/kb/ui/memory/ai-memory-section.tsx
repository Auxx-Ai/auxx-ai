// apps/web/src/components/kb/ui/memory/ai-memory-section.tsx
'use client'

import { FeatureKey, PermissionKey } from '@auxx/lib/permissions/client'
import { ListCard } from '@auxx/ui/components/list-card'
import { toastError } from '@auxx/ui/components/toast'
import { Sparkles } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCapabilityGate } from '~/components/global/capability-gate'
import { SettingsSection } from '~/components/global/settings-page'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'

/**
 * "AI Memory" section on the Knowledge Bases tab — the human door into the
 * org's learned KB. Opening the card lazily provisions the KB (idempotent)
 * and lands in the memory-trimmed editor. Hidden without the `learnedMemory`
 * feature flag, or without the `knowledgeBase` Edit rung that
 * `kb.ensureLearnedMemory` asserts — showing a card that 403s on click is
 * worse than not showing it.
 */
export function AiMemorySection() {
  const router = useRouter()
  const { hasAccess } = useFeatureFlags()
  const { allowed: canEditKb } = useCapabilityGate(PermissionKey.knowledgeBaseEdit)

  const ensureLearnedMemory = api.kb.ensureLearnedMemory.useMutation({
    onSuccess: ({ id }) => {
      router.push(`/app/kb/${id}/editor?panel=articles`)
    },
    onError: (error) => {
      toastError({ title: 'Could not open AI Memory', description: error.message })
    },
  })

  if (!hasAccess(FeatureKey.learnedMemory) || !canEditKb) return null

  return (
    <SettingsSection icon={Sparkles} title='AI Memory' className='mt-8'>
      <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
        <ListCard
          title='AI Memory'
          ariaLabel='AI Memory'
          icon={<Sparkles className='size-4' />}
          description='What Auxx has learned from your conversations.'
          descriptionLines={2}
          pending={ensureLearnedMemory.isPending}
          pendingLabel='Opening…'
          onClick={() => ensureLearnedMemory.mutate()}
        />
      </div>
    </SettingsSection>
  )
}
