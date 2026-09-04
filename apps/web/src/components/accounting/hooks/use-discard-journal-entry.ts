// apps/web/src/components/accounting/hooks/use-discard-journal-entry.ts

'use client'

import { useCallback, useRef, useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

/** The two things a discard needs: what to act on, and what to call it. */
export interface DiscardableJournalEntry {
  id: string
  /** `'JNL-0006'`. Null on a record whose number hook never fired. */
  number: string | null
}

export interface UseDiscardJournalEntryOptions {
  /** Fires only after the archive actually landed. */
  onDiscarded?: (journalEntryId: string) => void
}

export interface DiscardJournalEntryState {
  /** Confirms, then discards. A cancel resolves to nothing happening. */
  requestDiscard: (entry: DiscardableJournalEntry) => Promise<void>
  isDiscarding: boolean
  /**
   * The server's own refusal sentence, or `null`.
   *
   * 🛑 Held in state rather than thrown at a toast (ground rule 9). A refusal
   * here names a posted entry and points at reversal, and that is exactly the
   * kind of message that must not vanish in four seconds. The caller renders it
   * through `EntryBlockers` with `status: 'discard_refused'`.
   */
  refusal: string | null
  clearRefusal: () => void
  /** Render this once, anywhere in the caller's tree. */
  ConfirmDialog: ReturnType<typeof useConfirm>[1]
}

/**
 * The Discard action, shared by the two doors a draft is reachable from - the
 * journal-entry drawer and the ledger page's Entries list
 * (plans/accounting/tasks/09-discard-a-draft-entry.md §3.4).
 *
 * One hook rather than two copies, because the two doors have to agree on the
 * confirm copy: a person who discards from the row and a person who discards
 * from the drawer are doing the same thing to the same record, and two wordings
 * would be two different promises about what happens to the number.
 *
 * ## What the copy has to say, and why
 *
 * 🛑 **It archives; it does not delete, and it does not come back from here.**
 * `journal_entry_number` is issued on CREATE out of a gapless sequence, so an
 * abandoned `JNL-0006` leaves a permanent hole - and that hole is correct,
 * because a bookkeeper reading `JNL-0005` then `JNL-0007` has to be able to find
 * out what happened in between. `UnifiedCrudHandler.restore()` exists but there
 * is no archived-entries screen to restore from, so the copy says "cannot be
 * undone from here" rather than implying a reversibility the product does not
 * offer.
 */
export function useDiscardJournalEntry(
  options: UseDiscardJournalEntryOptions = {}
): DiscardJournalEntryState {
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()
  const [refusal, setRefusal] = useState<string | null>(null)
  const discard = api.ledger.journalEntry.discard.useMutation()

  // Read through a ref so `requestDiscard` keeps a stable identity: the Entries
  // list builds one row callback per entry, and a callback re-created on every
  // render of the page re-renders the whole list with it.
  const onDiscardedRef = useRef(options.onDiscarded)
  onDiscardedRef.current = options.onDiscarded

  const mutate = discard.mutate
  const requestDiscard = useCallback(
    async (entry: DiscardableJournalEntry) => {
      const label = entry.number ?? 'this journal entry'
      const confirmed = await confirm({
        title: `Discard ${label}?`,
        description:
          'The entry is archived, not deleted, so the number stays accounted for and the ' +
          'sequence has no unexplained gap. It leaves the Entries list. This cannot be undone ' +
          'from here.',
        confirmText: 'Discard the entry',
        cancelText: 'Keep it',
        destructive: true,
      })
      if (!confirmed) return

      setRefusal(null)
      mutate(
        { id: entry.id },
        {
          onSuccess: () => {
            // Both reads that could still be showing the entry: the Entries
            // list, and the drawer's own record.
            void utils.ledger.journalEntry.list.invalidate()
            void utils.ledger.journalEntry.get.invalidate({ id: entry.id })
            onDiscardedRef.current?.(entry.id)
          },
          // The server's sentence verbatim - it names the entry and the remedy,
          // and paraphrasing it would throw away the only part that says what to
          // do next.
          onError: (error) => setRefusal(error.message),
        }
      )
    },
    [confirm, mutate, utils]
  )

  const clearRefusal = useCallback(() => setRefusal(null), [])

  return {
    requestDiscard,
    isDiscarding: discard.isPending,
    refusal,
    clearRefusal,
    ConfirmDialog,
  }
}
