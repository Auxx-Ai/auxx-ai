// apps/web/src/components/agents/ui/detail/knowledge/use-scope-mutations.ts
'use client'

import type { AgentScopeMode } from '@auxx/lib/agents/client'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useRef } from 'react'
import { api } from '~/trpc/react'
import type { AgentDetail } from '../../../store/agent-store'

interface UseScopeMutationsReturn {
  setMode: (recordId: string, mode: AgentScopeMode | 'none') => Promise<void>
}

/**
 * Per-agent knowledge entry mutations with optimistic updates against the
 * `agent.getById` cache. Reads come from `agent.knowledge`; entries update
 * in place and reconcile via invalidate on success.
 *
 * The `agentSlug` param is required because `AgentDetailLoader` subscribes to
 * `agent.getById` by slug (from the URL), so optimistic writes must target
 * the slug-keyed cache entry — not the UUID-keyed one.
 */
export function useScopeMutations(
  agentId: string,
  agentSlug: string,
  onSavingChange?: (saving: boolean) => void
): UseScopeMutationsReturn {
  const utils = api.useUtils()
  const upsertRow = api.agentScope.upsertRow.useMutation()
  const removeRow = api.agentScope.removeRow.useMutation()
  const savingTimerRef = useRef<ReturnType<typeof setTimeout>>()

  // Invalidate without a key so both slug-keyed and id-keyed entries refetch.
  const reconcile = useCallback(async () => {
    await utils.agent.getById.invalidate()
  }, [utils.agent.getById])

  const optimisticKnowledge = useCallback(
    (mutator: (knowledge: AgentDetail['knowledge']) => AgentDetail['knowledge']) => {
      const previous = utils.agent.getById.getData({ agentId: agentSlug })
      utils.agent.getById.setData({ agentId: agentSlug }, (old) =>
        old ? { ...old, knowledge: mutator(old.knowledge) } : old
      )
      return previous
    },
    [agentSlug, utils.agent.getById]
  )

  const setMode = useCallback<UseScopeMutationsReturn['setMode']>(
    async (recordId, mode) => {
      savingTimerRef.current = setTimeout(() => onSavingChange?.(true), 400)

      const previous = optimisticKnowledge((knowledge) => {
        const filtered = knowledge.filter((k) => k.recordId !== recordId)
        if (mode === 'none') return filtered
        return [
          ...filtered,
          {
            recordId,
            mode,
            source: 'manual' as const,
          },
        ]
      })

      try {
        if (mode === 'none') {
          await removeRow.mutateAsync({ agentId, recordId })
        } else {
          await upsertRow.mutateAsync({ agentId, recordId, mode })
        }
        await reconcile()
      } catch (err) {
        utils.agent.getById.setData({ agentId: agentSlug }, previous)
        toastError({
          title: 'Failed to update access',
          description: err instanceof Error ? err.message : 'Unknown error',
        })
      } finally {
        clearTimeout(savingTimerRef.current)
        onSavingChange?.(false)
      }
    },
    [
      agentId,
      agentSlug,
      onSavingChange,
      optimisticKnowledge,
      reconcile,
      removeRow,
      upsertRow,
      utils.agent.getById,
    ]
  )

  return { setMode }
}
