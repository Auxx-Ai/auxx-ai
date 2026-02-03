// apps/web/src/components/mail/email-editor/hooks/use-draft.ts
'use client'

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
  console.log('[useDraft] fetching draftId:', draftId, 'enabled:', enabled && !!draftId)

  const query = api.draft.getById.useQuery(
    { draftId: draftId! },
    {
      enabled: enabled && !!draftId,
      // Always fetch fresh data - drafts change frequently via autosave
      staleTime: 0,
    }
  )

  console.log('[useDraft] query.data:', query.data?.id, 'textHtml length:', query.data?.textHtml?.length)

  return {
    draft: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  }
}
