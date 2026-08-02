// apps/web/src/components/mail-filters/ui/thread-filter-entry.tsx

'use client'

import { getInstanceId } from '@auxx/types/resource'
import { DropdownMenuItem } from '@auxx/ui/components/dropdown-menu'
import { Filter } from 'lucide-react'
import { useMemo } from 'react'
import { useThreadCounterparty } from '~/components/mail/hooks/use-thread-counterparty'
import { useThread } from '~/components/threads/hooks'
import { useAuthorableInboxes } from '../hooks/use-authorable-inboxes'
import { buildThreadPrefillConditions, toConditionGroups } from '../utils/prefill-conditions'
import { MailFilterPrefillDialog } from './mail-filter-prefill-dialog'

/**
 * "Filter messages like this" — the thread overflow menu's creation entry point
 * (§6.3), Gmail's flow.
 *
 * The two halves are separate components on purpose: a `DropdownMenuContent`
 * unmounts its children when the menu closes, and choosing the item closes the
 * menu — so a dialog rendered inside it would be destroyed by the very click
 * that opened it. The header owns the open state and mounts
 * {@link ThreadFilterPrefillDialog} outside the menu.
 */

/**
 * Resolve the thread's inbox as an EntityInstance id, which is what
 * `MailFilter.inboxId` and `authorableInboxes` speak.
 *
 * `Thread.inboxId` is a `RecordId` — the def prefix differs for `inbox` vs
 * `personal_inbox`, so a bare comparison against either would be wrong for half
 * the mailboxes in the org.
 */
function useThreadInboxInstanceId(threadId: string): string | null {
  const { thread } = useThread({ threadId })
  return thread?.inboxId ? getInstanceId(thread.inboxId) : null
}

interface ThreadFilterMenuItemProps {
  threadId: string
  onSelect: () => void
}

/**
 * The menu item, shown only when the caller may author filters on THIS thread's
 * inbox.
 *
 * Gated on `api.mailFilters.authorableInboxes` — the same set the router scopes
 * every filter read and write with (§5.1) — and never on admin rank
 * (invariant 7). A member with a personal mailbox sees it on their own mail
 * without holding any automation grant; an org admin does not see it on an inbox
 * they cannot write to.
 */
export function ThreadFilterMenuItem({ threadId, onSelect }: ThreadFilterMenuItemProps) {
  const inboxInstanceId = useThreadInboxInstanceId(threadId)
  const { canAuthor } = useAuthorableInboxes()
  if (!canAuthor(inboxInstanceId)) return null

  return (
    <DropdownMenuItem onClick={onSelect}>
      <Filter />
      Filter messages like this
    </DropdownMenuItem>
  )
}

interface ThreadFilterPrefillDialogProps {
  threadId: string
  onClose: () => void
}

/**
 * The prefilled dialog: `from is <sender>` and `subject contains <subject>`,
 * both editable, on the thread's own inbox.
 *
 * The sender is the thread's COUNTERPARTY rather than the first `FROM` blindly,
 * so an owner-initiated thread prefills the customer's address instead of the
 * mailbox's own — a filter on your own address would match nothing inbound.
 */
export function ThreadFilterPrefillDialog({ threadId, onClose }: ThreadFilterPrefillDialogProps) {
  const { thread } = useThread({ threadId })
  const inboxInstanceId = useThreadInboxInstanceId(threadId)
  const counterparty = useThreadCounterparty(threadId)

  const senderEmail = useMemo(() => {
    const participant = counterparty.primary ?? counterparty.fallback
    // Only an email identifier makes sense on `from`, which compiles to an
    // `ilike` over `Participant.identifier`. A chat/social handle would build a
    // condition that can never match an email thread.
    const identifier = participant?.identifier
    return identifier?.includes('@') ? identifier : null
  }, [counterparty.primary, counterparty.fallback])

  const groups = useMemo(
    () =>
      toConditionGroups(buildThreadPrefillConditions({ senderEmail, subject: thread?.subject })),
    [senderEmail, thread?.subject]
  )

  // The prefill is frozen when the dialog mounts, so wait for the participants
  // to resolve first — mounting early would permanently freeze a filter with no
  // sender condition in it, which is the half the user came for.
  if (counterparty.isLoading) return null

  return (
    <MailFilterPrefillDialog
      onClose={onClose}
      name={senderEmail ? `Mail from ${senderEmail}` : undefined}
      conditions={groups}
      inboxId={inboxInstanceId ?? undefined}
    />
  )
}
