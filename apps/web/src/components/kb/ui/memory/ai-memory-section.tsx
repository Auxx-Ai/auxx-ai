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
import { useKnowledgeBasesList } from '../knowledge-bases/knowledge-bases-provider'

/**
 * "AI Memory" section on the Knowledge Bases tab — the human door into the
 * org's learned KB. Opening the card lazily provisions the KB (idempotent)
 * and lands in the memory-trimmed editor. Hidden without the `learnedMemory`
 * feature flag, or without the `knowledgeBase` Edit rung that
 * `kb.ensureLearnedMemory` asserts — showing a card that 403s on click is
 * worse than not showing it.
 *
 * 🔴 Also hidden once the KB **exists**: `kb.list` now returns `kind: 'learned'`
 * rows (plan v3/06 P4), so a provisioned AI Memory already has a real tile in
 * the grid above — one with a Share card, which is the whole point of P4 and
 * which this provisioning shortcut cannot offer. Rendering both would put two
 * "AI Memory" cards on one page. This section survives only as the **create**
 * door for an org that has never provisioned one.
 */
export function AiMemorySection() {
  const router = useRouter()
  const { hasAccess } = useFeatureFlags()
  const { allowed: canEditKb } = useCapabilityGate(PermissionKey.knowledgeBaseEdit)
  const { hasLearnedKnowledgeBase } = useKnowledgeBasesList()

  const ensureLearnedMemory = api.kb.ensureLearnedMemory.useMutation({
    onSuccess: ({ id }) => {
      router.push(`/app/kb/${id}/editor?panel=articles`)
    },
    onError: (error) => {
      toastError({ title: 'Could not open AI Memory', description: error.message })
    },
  })

  if (!hasAccess(FeatureKey.learnedMemory) || !canEditKb) return null
  if (hasLearnedKnowledgeBase) return null

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
