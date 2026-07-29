// apps/web/src/components/threads/hooks/use-my-inbox-lenses.ts

'use client'

import type { Lens } from '@auxx/lib/permissions/visibility/client'
import type { ChannelLens } from '@auxx/lib/realtime/client'
import { api } from '~/trpc/react'

const EMPTY_LENSES: Record<string, ChannelLens> = {}
const EMPTY_FLOORS: Record<string, Lens> = {}

/**
 * The caller's effective lens per inbox (mail-permissions §6.4) — the
 * server-computed `inbox.myLenses` read over the cached `userMailVisibility`.
 * Drives the per-lens realtime channel subscriptions in `useMailSync` and the
 * `myLens` field on `useInboxes` items. Refetched on `visibility:changed`.
 *
 * Also the client's source for each inbox's ORG-WIDE FLOOR (plan 40 §6). The
 * floor is a `role:org_member` `ResourceAccess` row now, not the
 * `inbox_default_lens` FieldValue the record layer used to surface — so it
 * cannot come off the inbox record any more, and the alternative (a
 * `resourceAccess.forInstance` query per inbox) would mean one round trip per
 * badge in the inbox list. It rides on this query instead.
 */
export function useMyInboxLenses(enabled = true) {
  const { data, isLoading } = api.inbox.myLenses.useQuery(undefined, {
    enabled,
    staleTime: 5 * 60 * 1000,
  })
  return {
    /** inboxId → the viewer's lens; inboxes at `none` are absent. */
    lenses: data?.lenses ?? EMPTY_LENSES,
    /**
     * inboxId → the inbox's org-wide floor. `full` when no baseline row is
     * authored (the org-shared default); always `none` for a personal mailbox,
     * which has no org-wide floor at all.
     */
    floors: data?.floors ?? EMPTY_FLOORS,
    /** Org admins additionally see the residual `none` (triage) channel. */
    isAdmin: data?.isAdmin ?? false,
    /** False until the first fetch lands — don't subscribe to anything yet. */
    isLoaded: enabled && !isLoading && !!data,
  }
}
