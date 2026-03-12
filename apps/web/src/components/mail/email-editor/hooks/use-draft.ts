// apps/web/src/components/mail/email-editor/hooks/use-draft.ts
'use client'

import { useEffect } from 'react'
import { getThreadStoreState } from '~/components/threads/store/thread-store'
import { api } from '~/trpc/react'
import type { DraftMessage } from '../types'

/**
 * Options for useDraft hook
 */
export interface UseDraftOptions {
  /** Draft ID to fetch */
  draftId: string | null | undefined
  /** Whether the query is enabled */
  enabled?: boolean
}

/**
 * Return type for useDraft hook
 */
export interface UseDraftReturn {
  /** The draft data */
  draft: DraftMessage | undefined
  /** Whether the query is loading */
  isLoading: boolean
  /** Whether the query has an error */
  isError: boolean
  /** Refetch the draft */
  refetch: () => void
}

/**
 * Hook for fetching a single draft by ID.
 */
export function useDraft({ draftId, enabled = true }: UseDraftOptions): UseDraftReturn {
  const query = api.draft.getById.useQuery(
    { draftId: draftId! },
    {
      enabled: enabled && !!draftId,
      // Always fetch fresh data - drafts change frequently via autosave
      staleTime: 0,
      retry: (failureCount, error) => {
        // Don't retry NOT_FOUND errors (draft was deleted after send)
        if (error.data?.code === 'NOT_FOUND') return false
        return failureCount < 3
      },
    }
  )

  // Defense-in-depth: if query fails with NOT_FOUND, tombstone the draft
  // so useReplyBox skips future fetch attempts
  useEffect(() => {
    if (query.isError && draftId && query.error?.data?.code === 'NOT_FOUND') {
      getThreadStoreState().markDraftNotFound(draftId)
    }
  }, [query.isError, query.error?.data?.code, draftId])

  return {
    draft: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  }
}
