// apps/web/src/components/mail-filters/hooks/use-inbox-identifier-types.ts

'use client'

import { identifierTypeForProvider } from '@auxx/lib/channels/client'
import { useMemo } from 'react'
import { api } from '~/trpc/react'

/** Channel lists move with connect/disconnect, not with typing. */
const CHANNELS_STALE_TIME = 60_000

/**
 * The identifier types the channels attached to one inbox can produce —
 * `['PHONE']` for the Quo inbox, `['EMAIL']` for Outlook, `['EMAIL','PHONE']`
 * for a mixed one.
 *
 * An inbox is a UNION of channel types, never one type (plan 09 §2): dev alone
 * has a "Shared Inbox" on `google` + `email` and a "Chat Support" on `chat` +
 * `google`, and a channel can be attached after a filter is written. So this is
 * recomputed per render from the live channel list and used only as a soft hint.
 *
 * **Fails open.** Returns an empty array while the query is loading, when the
 * caller lacks the capability to read channels, and when the inbox genuinely has
 * none — and every consumer reads an empty array as "do not narrow anything".
 * Losing a suggestion is cheap; hiding a field the author needed is not.
 *
 * `provider` → `IdentifierType` goes through `identifierTypeForProvider`, the
 * one declared map (a fourth hand-written provider switch is what left
 * `openphone` out of the composer's From picker for months).
 *
 * @param inboxId Inbox EntityInstance id, or undefined before one is chosen.
 */
export function useInboxIdentifierTypes(inboxId?: string | null): string[] {
  const { data } = api.channel.list.useQuery(undefined, { staleTime: CHANNELS_STALE_TIME })

  return useMemo(() => {
    if (!inboxId || !data) return []
    const types = new Set<string>()
    for (const channel of data.channels) {
      if (channel.inboxId !== inboxId) continue
      const type = identifierTypeForProvider(channel.provider)
      if (type) types.add(type)
    }
    return [...types]
  }, [data, inboxId])
}
