// apps/web/src/components/threads/hooks/use-my-inbox-lenses.ts

'use client'

import type { ChannelLens } from '@auxx/lib/realtime/client'
import { api } from '~/trpc/react'

const EMPTY_LENSES: Record<string, ChannelLens> = {}

/**
 * The caller's effective lens per inbox (mail-permissions §6.4) — the
 * server-computed `inbox.myLenses` read over the cached `userMailVisibility`.
 * Drives the per-lens realtime channel subscriptions in `useMailSync` and the
 * `myLens` field on `useInboxes` items. Refetched on `visibility:changed`.
 */
export function useMyInboxLenses() {
  const { data, isLoading } = api.inbox.myLenses.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  })
  return {
    /** inboxId → the viewer's lens; inboxes at `none` are absent. */
    lenses: data?.lenses ?? EMPTY_LENSES,
    /** Org admins additionally see the residual `none` (triage) channel. */
    isAdmin: data?.isAdmin ?? false,
    /** False until the first fetch lands — don't subscribe to anything yet. */
    isLoaded: !isLoading && !!data,
  }
}
