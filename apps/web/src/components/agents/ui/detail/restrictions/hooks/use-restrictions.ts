// apps/web/src/components/agents/ui/detail/restrictions/hooks/use-restrictions.ts
'use client'

import type { ToolBindingMap } from '@auxx/lib/agents/bindings/client'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback } from 'react'
import { api } from '~/trpc/react'
import type { AgentDetail } from '../../../../store/agent-store'

export interface UseBindingsResult {
  /** Current binding override map off the agent detail. */
  bindings: ToolBindingMap
  /** Full-replace write of the override map. Resolves once invalidation kicks off. */
  save: (next: ToolBindingMap) => Promise<void>
  isSaving: boolean
}

/**
 * Read/write the agent's tool-binding **override** map (stored on the
 * `toolRestrictions` column). Reads off the already-loaded agent detail; writes
 * go through the full-replace `agent.setToolBindings` mutation and invalidate
 * the detail query on success. Errors surface via `toastError`; no success
 * toast (house rule). See plans/chat/v8 phase-5.
 */
export function useBindings(agent: AgentDetail): UseBindingsResult {
  const utils = api.useUtils()
  const setBindings = api.agent.setToolBindings.useMutation({
    onSuccess: () => utils.agent.getById.invalidate({ agentId: agent.slug }),
    onError: (err) => toastError({ title: 'Failed to save binding', description: err.message }),
  })

  const save = useCallback(
    async (next: ToolBindingMap) => {
      await setBindings.mutateAsync({ agentId: agent.id, bindings: next })
    },
    [agent.id, setBindings]
  )

  return {
    bindings: agent.toolRestrictions ?? {},
    save,
    isSaving: setBindings.isPending,
  }
}
