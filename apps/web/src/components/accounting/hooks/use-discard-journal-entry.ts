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
  /** Fires only after the delete actually landed. */
  onDiscarded?: (journalEntryId: string) => void
}

export interface DiscardJournalEntryState {
  /** Confirms, then discards. A cancel resolves to nothing happening. */
  requestDiscard: (entry: DiscardableJournalEntry) => Promise<void>
  isDiscarding: boolean
  /** The server's refusal sentence, rendered as a `discard_refused` card rather than a toast. */
  refusal: string | null
  clearRefusal: () => void
  /** Render this once, anywhere in the caller's tree. */
  ConfirmDialog: ReturnType<typeof useConfirm>[1]
}

/**
 * Discard an unposted journal entry: the record and its lines are deleted (91 D5).
 * Shared by the drawer and the Entries list so both confirm with the same words.
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
          'The entry and its lines are deleted. It was never posted, so the books do not ' +
          'change. Its number is not reused. This cannot be undone.',
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
