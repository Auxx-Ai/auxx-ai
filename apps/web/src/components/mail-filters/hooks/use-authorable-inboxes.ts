// apps/web/src/components/mail-filters/hooks/use-authorable-inboxes.ts

'use client'

import { useMemo } from 'react'
import { api } from '~/trpc/react'
import type { AuthorableInboxOption } from './use-mail-filter-lookups'

/**
 * Authorship changes with permissions and inbox membership, neither of which
 * moves during a mail session — so the mail UI's three entry points read one
 * cached answer instead of re-asking per thread.
 */
const AUTHORABLE_INBOXES_STALE_TIME = 5 * 60_000

export interface AuthorableInboxes {
  inboxes: AuthorableInboxOption[]
  /** True when the caller may author a filter on at least one inbox. */
  canAuthorAny: boolean
  /** True when this exact inbox (an EntityInstance id) is authorable. */
  canAuthor: (inboxId: string | null | undefined) => boolean
}

/**
 * The inboxes the caller may write filters for — the gate behind every mail-UI
 * mail-filter surface (§5.1, §6.4).
 *
 * The same computation the router scopes `list`, `create` and `undoRun` with, so
 * the UI can never offer something the router would refuse. **Never gate on
 * admin rank** (invariant 7): a member with a personal mailbox is in this set
 * without holding any automation grant, and an automation admin is not in it for
 * an inbox they cannot write to.
 */
export function useAuthorableInboxes(): AuthorableInboxes {
  const { data } = api.mailFilters.authorableInboxes.useQuery(undefined, {
    staleTime: AUTHORABLE_INBOXES_STALE_TIME,
  })

  return useMemo(() => {
    const inboxes = data ?? []
    const ids = new Set(inboxes.map((inbox) => inbox.id))
    return {
      inboxes,
      canAuthorAny: inboxes.length > 0,
      canAuthor: (inboxId) => !!inboxId && ids.has(inboxId),
    }
  }, [data])
}
