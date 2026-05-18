// apps/web/src/components/agents/hooks/use-agent-mutations.ts
'use client'

import { type FlatToolCatalogEntry, reconcilePromptMentions } from '@auxx/lib/agents/client'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback } from 'react'
import { api } from '~/trpc/react'
import { type AgentDetail, getAgentStoreState } from '../store/agent-store'

interface CreateAgentInput {
  /** Omit for chat-driven creation; backing User.name stays null. */
  name?: string
  /** Omit to let the server default `slug = id`. */
  slug?: string
  description?: string | null
}

interface UpdateAgentInput {
  name?: string
  slug?: string
  description?: string | null
  modelId?: string | null
  mentionable?: boolean
  archivedAt?: Date | null
  /** Persona Tiptap doc (`{ type: 'doc', content: [...] }`). */
  prompt?: Record<string, unknown>
}

interface UseAgentMutationsResult {
  createAgent: (input?: CreateAgentInput) => Promise<{ agentId: string; slug: string } | undefined>
  updateAgent: (id: string, patch: UpdateAgentInput) => Promise<boolean>
  archiveAgent: (id: string) => Promise<boolean>
  unarchiveAgent: (id: string) => Promise<boolean>
  discardDraft: (id: string) => Promise<boolean>
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
  const discardDraftMutation = api.agent.deleteDraft.useMutation()

  const createAgent = useCallback<UseAgentMutationsResult['createAgent']>(
    async (input) => {
      try {
        const result = await createMutation.mutateAsync({
          name: input?.name,
          slug: input?.slug,
          description: input?.description ?? undefined,
        })
        // Skip pre-redirect list invalidate so the agents grid below the
        // create button doesn't pop in a "Setting up" card before navigation
        // commits. The list refetches on remount when the user comes back.
        // Server defaults slug to id when omitted; use whichever the
        // caller passed, falling back to the returned id.
        return { agentId: result.agentId, slug: input?.slug ?? result.agentId }
      } catch (error) {
        toastError({
          title: 'Failed to create agent',
          description: error instanceof Error ? error.message : 'Unknown error occurred',
        })
        return undefined
      }
    },
    [createMutation]
  )

  const updateAgent = useCallback<UseAgentMutationsResult['updateAgent']>(
    async (id, patch) => {
      const store = getAgentStoreState()
      // The persona editor flushes ~1.5s after each typing burst. The
      // `prompt` field isn't surfaced anywhere outside the editor itself
      // (no list column, no header, no breadcrumb), and the editor is
      // authoritative for the live doc. So a `prompt`-only patch skips
      // both the optimistic store path and `getById.invalidate()` — that
      // invalidate was the headline cause of typing lag in PersonaEditor
      // because it refetched the page-driving query and re-rendered the
      // detail subtree on every save. We splice `prompt` into the
      // `getById` cache so a fresh mount sees the saved doc.
      const isPromptOnly =
        patch.prompt !== undefined &&
        patch.name === undefined &&
        patch.slug === undefined &&
        patch.description === undefined &&
        patch.modelId === undefined &&
        patch.mentionable === undefined &&
        patch.archivedAt === undefined

      if (isPromptOnly) {
        // Mirror the server-side reconciler client-side, optimistically. The
        // server runs `reconcilePromptMentions` on flush; we run the same
        // pure function here against the cached tool catalog so the Lock
        // badge on `tool:<name>` chips lights up the same keystroke they
        // land — instead of waiting for the 1.5s autosave round-trip.
        const toolCatalog =
          (utils.agentToolset.listTools.getData() as FlatToolCatalogEntry[] | undefined) ?? []
        const stored = store.agentsById[id]
        const slug = stored?.slug
        const splice = (prev: AgentDetail | undefined): AgentDetail | undefined => {
          if (!prev) return prev
          const reconciled = reconcilePromptMentions({
            prompt: patch.prompt as Record<string, unknown>,
            current: { toolsets: prev.toolsets, knowledge: prev.knowledge },
            toolCatalog,
          })
          return {
            ...prev,
            prompt: patch.prompt as AgentDetail['prompt'],
            toolsets: reconciled.toolsets,
            knowledge: reconciled.knowledge,
          }
        }
        // Splice BEFORE awaiting — the whole point is to take the autosave
        // round-trip out of the perceived latency. No rollback on failure:
        // the next successful save (or any non-prompt-only mutation, which
        // invalidates getById below) re-reconciles authoritatively.
        utils.agent.getById.setData({ agentId: id }, splice)
        if (slug && slug !== id) {
          utils.agent.getById.setData({ agentId: slug }, splice)
        }
        try {
          await updateMutation.mutateAsync({ agentId: id, ...patch })
          return true
        } catch (error) {
          toastError({
            title: 'Failed to update agent',
            description: error instanceof Error ? error.message : 'Unknown error occurred',
          })
          return false
        }
      }

      // Scalar / mixed patches keep the optimistic store path so the
      // sidebar / breadcrumb switcher react instantly.
      const optimistic: Record<string, unknown> = {}
      if (patch.name !== undefined) optimistic.name = patch.name
      if (patch.slug !== undefined) optimistic.slug = patch.slug
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
    [updateMutation, utils.agent.list, utils.agent.getById, utils.agentToolset.listTools]
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

  const discardDraft = useCallback<UseAgentMutationsResult['discardDraft']>(
    async (id) => {
      try {
        await discardDraftMutation.mutateAsync({ agentId: id })
        await utils.agent.list.invalidate()
        return true
      } catch (error) {
        toastError({
          title: 'Failed to discard draft',
          description: error instanceof Error ? error.message : 'Unknown error occurred',
        })
        return false
      }
    },
    [discardDraftMutation, utils.agent.list]
  )

  return {
    createAgent,
    updateAgent,
    archiveAgent,
    unarchiveAgent,
    discardDraft,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
  }
}
