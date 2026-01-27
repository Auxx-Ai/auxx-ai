// apps/web/src/components/threads/hooks/use-inbox.ts

import { useMemo } from 'react'
import { useInbox as useInboxHook } from '~/hooks/use-inbox'
import { type InboxWithRelations } from '@auxx/lib/types'

/**
 * Result of useInboxById hook.
 */
interface UseInboxByIdResult {
  /** The inbox matching the provided ID */
  inbox: InboxWithRelations | undefined
  /** Whether the inboxes are still loading */
  isLoading: boolean
}

/**
 * Hook to get a single inbox by ID.
 * Uses the existing useInbox hook that fetches all inboxes and filters by ID.
 *
 * @example
 * const { inbox, isLoading } = useInboxById(thread?.inboxId)
 */
export function useInboxById(inboxId: string | null | undefined): UseInboxByIdResult {
  const { inboxes, isLoading } = useInboxHook()

  const inbox = useMemo(() => {
    if (!inboxId || !inboxes) return undefined
    return inboxes.find((inbox) => inbox.id === inboxId)
  }, [inboxId, inboxes])

  return {
    inbox,
    isLoading,
  }
}
