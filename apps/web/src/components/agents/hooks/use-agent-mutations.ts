// apps/web/src/components/agents/hooks/use-agent-mutations.ts
'use client'

import { type FlatToolCatalogEntry, reconcilePromptMentions } from '@auxx/lib/agents/client'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback } from 'react'
import { api, type RouterOutputs } from '~/trpc/react'
import { type AgentDetail, getAgentStoreState } from '../store/agent-store'

/** What `agent.publish` reports back — the new version plus its author clamp. */
export type PublishAgentResult = RouterOutputs['agent']['publish']

interface CreateAgentInput {
  /** Omit for chat-driven creation; backing User.name stays null. */
  name?: string
  /** Omit to let the server default `slug = id`. */
  slug?: string
  description?: string | null
  /** Invocation surface. Defaults to `'internal'` server-side when omitted. */
  kind?: 'internal' | 'chat'
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
  /**
   * Run-as delegation (capability layer v2 §0.6) — a member's user id makes
   * every run resolve that member's capabilities; `null` clears it. Server
   * rejects anything but an ACTIVE `userType:'USER'` member.
   */
  runAsUserId?: string | null
}

interface UseAgentMutationsResult {
  createAgent: (input?: CreateAgentInput) => Promise<{ agentId: string; slug: string } | undefined>
  updateAgent: (id: string, patch: UpdateAgentInput) => Promise<boolean>
  archiveAgent: (id: string) => Promise<boolean>
  unarchiveAgent: (id: string) => Promise<boolean>
  deleteAgent: (id: string) => Promise<boolean>
  /**
   * Hard-delete a pre-`completeAgentSetup` draft agent (the agents-list "Discard
   * draft" item). NOT the version-draft action — that's {@link discardChanges}.
   */
  deleteSetupDraft: (id: string) => Promise<boolean>
  /**
   * Publish the agent's draft as a new version. Resolves with the new version's
   * number plus every reduction the §2.4a author clamp applied
   * (`min(profilePolicy, publisher's own capabilities)`) — `undefined` on
   * failure. The clamp is returned, never swallowed: the publish UI has to be
   * able to say "Deals reduced from Full to Read — you hold Read".
   */
  publishAgent: (id: string, label?: string) => Promise<PublishAgentResult | undefined>
  /** Restore a past version into the draft (marks dirty; does not go live). */
  restoreVersion: (id: string, toVersionId: string) => Promise<boolean>
  /** Rename a published version's label. */
  renameVersion: (agentId: string, versionId: string, label: string | null) => Promise<void>
  /** Discard unpublished draft changes (restore the active version onto the row). */
  discardChanges: (id: string) => Promise<boolean>
  isCreating: boolean
  isUpdating: boolean
  isPublishing: boolean
  isRestoring: boolean
  isDiscarding: boolean
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
  const deleteSetupDraftMutation = api.agent.deleteDraft.useMutation()
  const deleteMutation = api.agent.delete.useMutation()
  const publishMutation = api.agent.publish.useMutation()
  const restoreVersionMutation = api.agent.restoreVersion.useMutation()
  const renameVersionMutation = api.agent.renameVersion.useMutation()
  const discardChangesMutation = api.agent.discardChanges.useMutation()

  const createAgent = useCallback<UseAgentMutationsResult['createAgent']>(
    async (input) => {
      try {
        const result = await createMutation.mutateAsync({
          name: input?.name,
          slug: input?.slug,
          description: input?.description ?? undefined,
          kind: input?.kind ?? 'internal',
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
        patch.archivedAt === undefined &&
        patch.runAsUserId === undefined

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
            // Keep the publish pill in sync on the autosave fast path: a prompt
            // edit makes the draft dirty when a published baseline exists (the
            // server sets the same flag). See ui-plan §2.1.
            ...(prev.activeVersionId ? { hasUnpublishedChanges: true } : {}),
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

      // The detail view reads `agent.getById` directly (not the store), so
      // we also splice the patch into the query cache. Without this, the
      // hero's name/description revert to the prop value the moment the
      // inline editor closes and only flip to the new value after the
      // mutation round-trip + invalidate refetch settle.
      const stored = store.agentsById[id]
      const slug = stored?.slug
      const detailPatch: Partial<AgentDetail> = {}
      if (patch.name !== undefined) detailPatch.name = patch.name
      if (patch.slug !== undefined) detailPatch.slug = patch.slug
      if (patch.description !== undefined) detailPatch.description = patch.description
      if (patch.modelId !== undefined) detailPatch.modelId = patch.modelId
      if (patch.mentionable !== undefined) detailPatch.mentionable = patch.mentionable
      // `AgentDetail` mirrors the serialized tRPC payload, so the cache splice
      // must carry an ISO string — a raw Date here renders as `[object Date]`.
      if (patch.archivedAt !== undefined) {
        detailPatch.archivedAt = patch.archivedAt ? patch.archivedAt.toISOString() : null
      }
      // Run-as isn't surfaced in the list/store, only on the detail view.
      if (patch.runAsUserId !== undefined) detailPatch.runAsUserId = patch.runAsUserId
      // Behavior-field edits (prompt/modelId) flip the dirty pill when a
      // published baseline exists; identity edits (name/slug/description) don't.
      const behaviorChanged = patch.prompt !== undefined || patch.modelId !== undefined
      const spliceDetail = (prev: AgentDetail | undefined): AgentDetail | undefined => {
        if (!prev) return prev
        return {
          ...prev,
          ...detailPatch,
          ...(behaviorChanged && prev.activeVersionId ? { hasUnpublishedChanges: true } : {}),
        }
      }
      utils.agent.getById.setData({ agentId: id }, spliceDetail)
      if (slug && slug !== id) {
        utils.agent.getById.setData({ agentId: slug }, spliceDetail)
      }

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
    // Depend on the stable `mutateAsync`, not the whole `updateMutation` object
    // (React Query returns a new object every render). Keeping `updateAgent`
    // stable stops the autosave `patch`/`flush` callbacks — and the persona
    // editor's `onChange` memo — from being rebuilt on every render.
    [
      updateMutation.mutateAsync,
      utils.agent.list,
      utils.agent.getById,
      utils.agentToolset.listTools,
    ]
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

  const deleteAgent = useCallback<UseAgentMutationsResult['deleteAgent']>(
    async (id) => {
      try {
        await deleteMutation.mutateAsync({ agentId: id })
        await utils.agent.list.invalidate()
        return true
      } catch (error) {
        toastError({
          title: 'Failed to delete agent',
          description: error instanceof Error ? error.message : 'Unknown error occurred',
        })
        return false
      }
    },
    [deleteMutation, utils.agent.list]
  )

  const deleteSetupDraft = useCallback<UseAgentMutationsResult['deleteSetupDraft']>(
    async (id) => {
      try {
        await deleteSetupDraftMutation.mutateAsync({ agentId: id })
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
    [deleteSetupDraftMutation, utils.agent.list]
  )

  // Version mutations all refresh `agent.getById` (the pill + draft view) and
  // `agent.list`; cross-client refresh rides the existing `agent:updated`
  // realtime event. `renameVersion` touches only `agent.listVersions`.
  const invalidateAgent = useCallback(
    () => Promise.all([utils.agent.list.invalidate(), utils.agent.getById.invalidate()]),
    [utils.agent.list, utils.agent.getById]
  )

  const publishAgent = useCallback<UseAgentMutationsResult['publishAgent']>(
    async (id, label) => {
      try {
        const result = await publishMutation.mutateAsync({ agentId: id, label })
        await invalidateAgent()
        return result
      } catch (error) {
        toastError({
          title: 'Failed to publish agent',
          description: error instanceof Error ? error.message : 'Unknown error occurred',
        })
        return undefined
      }
    },
    [publishMutation, invalidateAgent]
  )

  const restoreVersion = useCallback<UseAgentMutationsResult['restoreVersion']>(
    async (id, toVersionId) => {
      try {
        await restoreVersionMutation.mutateAsync({ agentId: id, toVersionId })
        await invalidateAgent()
        return true
      } catch (error) {
        toastError({
          title: 'Failed to restore version',
          description: error instanceof Error ? error.message : 'Unknown error occurred',
        })
        return false
      }
    },
    [restoreVersionMutation, invalidateAgent]
  )

  const discardChanges = useCallback<UseAgentMutationsResult['discardChanges']>(
    async (id) => {
      try {
        await discardChangesMutation.mutateAsync({ agentId: id })
        await invalidateAgent()
        return true
      } catch (error) {
        toastError({
          title: 'Failed to discard changes',
          description: error instanceof Error ? error.message : 'Unknown error occurred',
        })
        return false
      }
    },
    [discardChangesMutation, invalidateAgent]
  )

  const renameVersion = useCallback<UseAgentMutationsResult['renameVersion']>(
    async (agentId, versionId, label) => {
      try {
        await renameVersionMutation.mutateAsync({ agentId, versionId, label })
        await utils.agent.listVersions.invalidate({ agentId })
      } catch (error) {
        toastError({
          title: 'Failed to rename version',
          description: error instanceof Error ? error.message : 'Unknown error occurred',
        })
      }
    },
    [renameVersionMutation, utils.agent.listVersions]
  )

  return {
    createAgent,
    updateAgent,
    archiveAgent,
    unarchiveAgent,
    deleteAgent,
    deleteSetupDraft,
    publishAgent,
    restoreVersion,
    renameVersion,
    discardChanges,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isPublishing: publishMutation.isPending,
    isRestoring: restoreVersionMutation.isPending,
    isDiscarding: discardChangesMutation.isPending,
  }
}
