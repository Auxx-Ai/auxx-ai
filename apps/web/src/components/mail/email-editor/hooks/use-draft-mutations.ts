// apps/web/src/components/mail/email-editor/hooks/use-draft-mutations.ts
'use client'

import type { StandaloneDraftMeta } from '@auxx/types/draft'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useRef } from 'react'
import { useCountUpdates } from '~/components/mail/hooks'
import { getThreadStoreState, useThreadStore } from '~/components/threads/store/thread-store'
import { api } from '~/trpc/react'
import type { DraftMessage, DraftPayload } from '../types'

/**
 * Options for useDraftMutations hook
 */
export interface UseDraftMutationsOptions {
  /** Thread ID for clearing draftIds on delete */
  threadId?: string | null
  /** Callback when upsert succeeds */
  onUpsertSuccess?: (result: DraftMessage) => void
  /** Callback when upsert fails */
  onUpsertError?: (error: Error) => void
  /** Callback when delete is about to start (optimistic update) */
  onDeleteMutate?: (draftId: string) => void
  /** Callback when delete succeeds */
  onDeleteSuccess?: (draftId: string) => void
  /** Callback when delete fails (for rollback) */
  onDeleteError?: (error: Error, draftId: string) => void
}

/**
 * Return type for useDraftMutations hook
 */
export interface UseDraftMutationsReturn {
  /** Create or update a draft */
  upsert: (payload: DraftPayload) => Promise<DraftMessage>
  /** Delete a draft by ID */
  deleteDraft: (draftId: string) => Promise<void>
  /** Whether an upsert is in progress */
  isUpserting: boolean
  /** Whether a delete is in progress */
  isDeleting: boolean
}

/**
 * Builds a recipient summary string from draft participants.
 * Example: "john@example.com +2"
 */
function buildRecipientSummary(
  participants: Array<{ role: string; participant: { identifier: string; name: string | null } }>
): string | null {
  const toRecipients = participants.filter((p) => p.role === 'TO')
  if (toRecipients.length === 0) return null

  const first = toRecipients[0]?.participant
  if (!first) return null

  const display = first.name || first.identifier
  if (toRecipients.length === 1) return display

  return `${display} +${toRecipients.length - 1}`
}

/**
 * Hook that encapsulates all draft mutation operations.
 * Handles upsert and delete with optimistic updates to ThreadStore.
 * Integrates with mail counts store for draft count updates.
 */
export function useDraftMutations(options?: UseDraftMutationsOptions): UseDraftMutationsReturn {
  // ThreadStore actions for standalone draft updates
  const setDrafts = useThreadStore((s) => s.setDrafts)
  const removeDraft = useThreadStore((s) => s.removeDraft)
  const updateThread = useThreadStore((s) => s.updateThread)

  // Count update helpers
  const { onCreateDraft, onDeleteDraft, rollback } = useCountUpdates()

  // Track if last upsert was a new draft (to know whether to update count)
  const wasNewDraftRef = useRef(false)

  // tRPC utils for cache invalidation
  const utils = api.useUtils()

  // Upsert mutation
  const upsertMutation = api.draft.upsert.useMutation({
    onSuccess: (result) => {
      // Update draft query cache directly with mutation result (no refetch needed)
      utils.draft.getById.setData({ draftId: result.id }, result)

      if (result.threadId) {
        // Thread-attached draft: add draftId to thread's draftIds if not already present
        const thread = getThreadStoreState().getThread(result.threadId)
        if (thread) {
          const recordId = `draft:${result.id}`
          if (!thread.draftIds.includes(recordId)) {
            updateThread(result.threadId, {
              draftIds: [...thread.draftIds, recordId],
            })
          }
        }
      } else {
        // Standalone draft: update ThreadStore standalone drafts
        const meta: StandaloneDraftMeta = {
          id: result.id,
          integrationId: result.integrationId,
          integrationProvider: null, // Not available from upsert result
          subject: result.subject || null,
          snippet: result.textPlain?.slice(0, 100) || null,
          recipientSummary: buildRecipientSummary(result.participants),
          updatedAt: result.updatedAt,
          createdAt: result.createdAt,
        }
        setDrafts([meta])
      }
      options?.onUpsertSuccess?.(result)
    },
    onError: (error) => {
      toastError({ title: 'Failed to save draft', description: error.message })
      options?.onUpsertError?.(error)
    },
  })

  // Delete mutation
  const deleteMutation = api.draft.delete.useMutation({
    onMutate: ({ draftId }) => {
      // Optimistic removal from ThreadStore (standalone drafts)
      removeDraft(draftId)

      // Also remove from thread's draftIds immediately (optimistic)
      if (options?.threadId) {
        const thread = getThreadStoreState().getThread(options.threadId)
        if (thread) {
          const recordId = `draft:${draftId}`
          updateThread(options.threadId, {
            draftIds: thread.draftIds.filter((id) => id !== recordId),
          })
        }
      }

      // Update draft count (optimistic)
      onDeleteDraft()

      // Call component's optimistic update callback
      options?.onDeleteMutate?.(draftId)
    },
    onSuccess: (_data, { draftId }) => {
      options?.onDeleteSuccess?.(draftId)
    },
    onError: (error, { draftId }) => {
      // Don't show error for "not found" - draft was already deleted
      const isNotFound =
        error.message?.includes('not found') || (error.data as any)?.code === 'NOT_FOUND'

      if (!isNotFound) {
        toastError({ title: 'Failed to delete draft', description: error.message })
        // Rollback count on error (unless draft wasn't found)
        rollback()
      }
      options?.onDeleteError?.(error, draftId)
    },
  })

  // Wrapped upsert function
  const upsert = useCallback(
    async (payload: DraftPayload): Promise<DraftMessage> => {
      // Track if this is a new draft (no existing draftId)
      const isNewDraft = !payload.draftId
      wasNewDraftRef.current = isNewDraft

      // Optimistically increment count for new drafts
      if (isNewDraft) {
        onCreateDraft()
      }

      try {
        return await upsertMutation.mutateAsync(payload)
      } catch (error) {
        // Rollback count on error for new drafts
        if (isNewDraft) {
          rollback()
        }
        throw error
      }
    },
    [upsertMutation, onCreateDraft, rollback]
  )

  // Wrapped delete function
  const deleteDraft = useCallback(
    async (draftId: string): Promise<void> => {
      await deleteMutation.mutateAsync({ draftId })
    },
    [deleteMutation]
  )

  return {
    upsert,
    deleteDraft,
    isUpserting: upsertMutation.isPending,
    isDeleting: deleteMutation.isPending,
  }
}
