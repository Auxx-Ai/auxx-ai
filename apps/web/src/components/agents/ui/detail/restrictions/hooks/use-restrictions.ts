// apps/web/src/components/agents/ui/detail/restrictions/hooks/use-restrictions.ts
'use client'

import type { ToolRestrictionMap } from '@auxx/lib/agents/restrictions/client'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback } from 'react'
import { api } from '~/trpc/react'
import type { AgentDetail } from '../../../../store/agent-store'

export interface UseRestrictionsResult {
  /** Current restriction map off the agent detail. */
  restrictions: ToolRestrictionMap
  /** Full-replace write. Resolves once the cache invalidation kicks off. */
  save: (next: ToolRestrictionMap) => Promise<void>
  isSaving: boolean
}

/**
 * Read/write the agent's `toolRestrictions` map. Reads off the already-loaded
 * agent detail; writes go through the full-replace `agent.setToolRestrictions`
 * mutation and invalidate the detail query on success. Errors surface via
 * `toastError`; no success toast (house rule). See plans/chat/v6 phase-4.
 */
export function useRestrictions(agent: AgentDetail): UseRestrictionsResult {
  const utils = api.useUtils()
  const setRestrictions = api.agent.setToolRestrictions.useMutation({
    onSuccess: () => utils.agent.getById.invalidate({ agentId: agent.slug }),
    onError: (err) => toastError({ title: 'Failed to save restriction', description: err.message }),
  })

  const save = useCallback(
    async (next: ToolRestrictionMap) => {
      await setRestrictions.mutateAsync({ agentId: agent.id, restrictions: next })
    },
    [agent.id, setRestrictions]
  )

  return {
    restrictions: agent.toolRestrictions ?? {},
    save,
    isSaving: setRestrictions.isPending,
  }
}
