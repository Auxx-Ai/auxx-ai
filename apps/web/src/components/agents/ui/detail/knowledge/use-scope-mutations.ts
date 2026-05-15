// apps/web/src/components/agents/ui/detail/knowledge/use-scope-mutations.ts
'use client'

import type { AgentScopeMode } from '@auxx/lib/agents/client'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useRef } from 'react'
import { api } from '~/trpc/react'
import type { AgentDetail } from '../../../store/agent-store'

interface UseScopeMutationsReturn {
  setMode: (recordId: string, mode: AgentScopeMode | 'none') => Promise<void>
  setPin: (recordId: string, pinned: boolean, note?: string | null) => Promise<void>
}

/**
 * Per-agent scope + pin mutations with optimistic updates against the
 * `agent.getById` cache. Reads come from `agent.resourceScopes` and
 * `agent.pinnedRecords`; both fields update in place and reconcile via
 * invalidate on success.
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
  const setPinMutation = api.agentScope.setPin.useMutation()
  const savingTimerRef = useRef<ReturnType<typeof setTimeout>>()

  // Invalidate without a key so both slug-keyed and id-keyed entries refetch.
  const reconcile = useCallback(async () => {
    await utils.agent.getById.invalidate()
  }, [utils.agent.getById])

  const optimisticScope = useCallback(
    (mutator: (scopes: AgentDetail['resourceScopes']) => AgentDetail['resourceScopes']) => {
      const previous = utils.agent.getById.getData({ agentId: agentSlug })
      utils.agent.getById.setData({ agentId: agentSlug }, (old) =>
        old ? { ...old, resourceScopes: mutator(old.resourceScopes) } : old
      )
      return previous
    },
    [agentSlug, utils.agent.getById]
  )

  const optimisticPins = useCallback(
    (mutator: (pins: AgentDetail['pinnedRecords']) => AgentDetail['pinnedRecords']) => {
      const previous = utils.agent.getById.getData({ agentId: agentSlug })
      utils.agent.getById.setData({ agentId: agentSlug }, (old) =>
        old ? { ...old, pinnedRecords: mutator(old.pinnedRecords) } : old
      )
      return previous
    },
    [agentSlug, utils.agent.getById]
  )

  const setMode = useCallback<UseScopeMutationsReturn['setMode']>(
    async (recordId, mode) => {
      savingTimerRef.current = setTimeout(() => onSavingChange?.(true), 400)
      const { entityDefinitionId, entityInstanceId } = splitRecordId(recordId)

      const previous = optimisticScope((scopes) => {
        const filtered = scopes.filter(
          (s) =>
            !(
              s.entityDefinitionId === entityDefinitionId && s.entityInstanceId === entityInstanceId
            )
        )
        if (mode === 'none') return filtered
        return [
          ...filtered,
          {
            id: `optimistic-${recordId}`,
            agentId,
            organizationId: '',
            entityDefinitionId,
            entityInstanceId,
            mode,
            source: 'manual',
            createdAt: new Date(),
            updatedAt: new Date(),
          } as AgentDetail['resourceScopes'][number],
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
      optimisticScope,
      reconcile,
      removeRow,
      upsertRow,
      utils.agent.getById,
    ]
  )

  const setPin = useCallback<UseScopeMutationsReturn['setPin']>(
    async (recordId, pinned, note) => {
      savingTimerRef.current = setTimeout(() => onSavingChange?.(true), 400)
      const previous = optimisticPins((pins) => {
        const filtered = pins.filter((p) => p.recordId !== recordId)
        if (!pinned) return filtered
        return [
          ...filtered,
          {
            recordId,
            pinReason: 'manual' as const,
            ...(note != null ? { note } : {}),
          },
        ]
      })

      try {
        await setPinMutation.mutateAsync({ agentId, recordId, pinned, note })
        await reconcile()
      } catch (err) {
        utils.agent.getById.setData({ agentId: agentSlug }, previous)
        toastError({
          title: 'Failed to update pin',
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
      optimisticPins,
      reconcile,
      setPinMutation,
      utils.agent.getById,
    ]
  )

  return { setMode, setPin }
}

function splitRecordId(recordId: string): {
  entityDefinitionId: string
  entityInstanceId: string | null
} {
  const colon = recordId.indexOf(':')
  if (colon === -1) return { entityDefinitionId: recordId, entityInstanceId: null }
  const def = recordId.slice(0, colon)
  const instance = recordId.slice(colon + 1)
  return { entityDefinitionId: def, entityInstanceId: instance.length > 0 ? instance : null }
}
