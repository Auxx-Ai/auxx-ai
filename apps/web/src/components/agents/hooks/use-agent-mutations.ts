// apps/web/src/components/agents/hooks/use-agent-mutations.ts
'use client'

import { toastError } from '@auxx/ui/components/toast'
import { useCallback } from 'react'
import { api } from '~/trpc/react'
import { getAgentStoreState } from '../store/agent-store'

interface CreateAgentInput {
  name: string
  slug: string
  description?: string | null
}

interface UpdateAgentInput {
  name?: string
  description?: string | null
  modelId?: string | null
  mentionable?: boolean
  archivedAt?: Date | null
}

interface UseAgentMutationsResult {
  createAgent: (input: CreateAgentInput) => Promise<{ agentId: string; slug: string } | undefined>
  updateAgent: (id: string, patch: UpdateAgentInput) => Promise<boolean>
  archiveAgent: (id: string) => Promise<boolean>
  unarchiveAgent: (id: string) => Promise<boolean>
  isCreating: boolean
  isUpdating: boolean
}

/**
 * Optimistic create/update/archive for agents. Pairs with the agents store so
 * the list, breadcrumb switcher, and detail header all reflect changes
 * instantly and reconcile on the next list refetch.
 */
export function useAgentMutations(): UseAgentMutationsResult {
  const utils = api.useUtils()
  const createMutation = api.agent.create.useMutation()
  const updateMutation = api.agent.update.useMutation()

  const createAgent = useCallback<UseAgentMutationsResult['createAgent']>(
    async (input) => {
      try {
        const result = await createMutation.mutateAsync({
          name: input.name,
          slug: input.slug,
          description: input.description ?? undefined,
        })
        await utils.agent.list.invalidate()
        return { agentId: result.agentId, slug: input.slug }
      } catch (error) {
        toastError({
          title: 'Failed to create agent',
          description: error instanceof Error ? error.message : 'Unknown error occurred',
        })
        return undefined
      }
    },
    [createMutation, utils.agent.list]
  )

  const updateAgent = useCallback<UseAgentMutationsResult['updateAgent']>(
    async (id, patch) => {
      const store = getAgentStoreState()
      // Only flat scalars belong in the optimistic patch — keep TS happy.
      const optimistic: Record<string, unknown> = {}
      if (patch.name !== undefined) optimistic.name = patch.name
      if (patch.description !== undefined) optimistic.description = patch.description
      if (patch.modelId !== undefined) optimistic.modelId = patch.modelId
      if (patch.mentionable !== undefined) optimistic.mentionable = patch.mentionable
      if (patch.archivedAt !== undefined) {
        optimistic.archivedAt = patch.archivedAt ? patch.archivedAt.toISOString() : null
      }
      store.setAgentOptimistic(id, optimistic as never)
      try {
        await updateMutation.mutateAsync({ agentId: id, ...patch })
        store.confirmAgentUpdate(id)
        await Promise.all([utils.agent.list.invalidate(), utils.agent.getById.invalidate()])
        return true
      } catch (error) {
        store.rollbackAgentUpdate(id)
        toastError({
          title: 'Failed to update agent',
          description: error instanceof Error ? error.message : 'Unknown error occurred',
        })
        return false
      }
    },
    [updateMutation, utils.agent.list, utils.agent.getById]
  )

  const archiveAgent = useCallback<UseAgentMutationsResult['archiveAgent']>(
    async (id) => {
      const store = getAgentStoreState()
      store.markAgentArchived(id)
      const ok = await updateAgent(id, { archivedAt: new Date() })
      if (ok) store.confirmAgentArchive(id)
      else store.rollbackAgentArchive(id)
      return ok
    },
    [updateAgent]
  )

  const unarchiveAgent = useCallback<UseAgentMutationsResult['unarchiveAgent']>(
    async (id) => updateAgent(id, { archivedAt: null }),
    [updateAgent]
  )

  return {
    createAgent,
    updateAgent,
    archiveAgent,
    unarchiveAgent,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
  }
}
