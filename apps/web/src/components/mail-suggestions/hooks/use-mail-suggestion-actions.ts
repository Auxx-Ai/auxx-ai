// apps/web/src/components/mail-suggestions/hooks/use-mail-suggestion-actions.ts

'use client'

import { describeSubjectKey } from '@auxx/lib/mail-suggestions/client'
import { toastError } from '@auxx/ui/components/toast'
import { useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import type { MailSuggestionCard } from './use-mail-suggestions'

/**
 * The three answers a suggestion card offers, shared verbatim by the Approvals
 * row and the in-thread chip (§8.2 / §8.3) so the two surfaces cannot diverge on
 * what a click does.
 */
export interface MailSuggestionActions {
  /** "Just archive" — accept the filter half only. */
  runAccept: () => void
  /** "Unsubscribe & archive" — S10's one click, two effects. */
  runUnsubscribeAndArchive: () => void
  /** "Dismiss" — a status write, permanent for this `subjectKey`. */
  runDismiss: () => void
  /**
   * "Block this sender" — the refusal branch's answer (§6.2). Adds the specific
   * from-address to the CHANNEL's excluded senders, which is prevention rather
   * than cleanup: `shouldIgnoreMessage` runs before the write, so the mail stops
   * becoming a thread at all.
   */
  runBlockSender: () => void
  isBlocking: boolean
  isPending: boolean
  /**
   * The server refused the unsubscribe at execute time (§6.2): the card must
   * render the block-sender alternative rather than a failure toast.
   */
  refusal: string | null
  /**
   * The `http` tier's URL, kept only when the popup was blocked — the user then
   * gets a real link to click instead of a silently swallowed tab.
   */
  pendingOpenUrl: string | null
  ConfirmDialog: () => React.ReactElement
}

/**
 * Wire one card's buttons to the router.
 *
 * **Accept is one click, not a dialog** (§8.4, S10 over §4): it calls the accept
 * mutation directly — which creates the filter through the ordinary
 * filter-create path server-side — and the retroactive *"also apply to N
 * existing conversations?"* step is a follow-up confirm, not the full filter
 * dialog.
 *
 * **Shared-inbox unsubscribe states its blast radius plainly** (§7.1, invariant
 * 11), through the destructive confirm variant, because it stops the mail for
 * colleagues who never saw the dialog.
 */
export function useMailSuggestionActions(
  suggestion: MailSuggestionCard,
  onResolved?: () => void
): MailSuggestionActions {
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()
  const [refusal, setRefusal] = useState<string | null>(null)
  const [pendingOpenUrl, setPendingOpenUrl] = useState<string | null>(null)

  const invalidate = () => {
    void utils.mailSuggestions.list.invalidate()
    void utils.mailSuggestions.count.invalidate()
    void utils.mailFilters.list.invalidate()
    onResolved?.()
  }

  const dismiss = api.mailSuggestions.dismiss.useMutation()
  const accept = api.mailSuggestions.accept.useMutation()
  const unsubscribe = api.mailSuggestions.unsubscribe.useMutation()
  const blockSender = api.mailSuggestions.blockSender.useMutation()
  const applyRetroactively = api.mailFilters.applyRetroactively.useMutation()

  const isPending =
    dismiss.isPending ||
    accept.isPending ||
    unsubscribe.isPending ||
    blockSender.isPending ||
    applyRetroactively.isPending

  /**
   * Create the filter, then offer the backfill.
   *
   * The count is a LOWER BOUND (the preview evaluates under the caller's own
   * viewer while the engine fires as SYSTEM), so the copy says "at least".
   */
  const acceptFilter = async (): Promise<boolean> => {
    const created = await accept.mutateAsync({ suggestionId: suggestion.id })
    if (created.matchCount > 0) {
      const count = created.matchCountCapped ? `${created.matchCount}+` : `${created.matchCount}`
      const confirmed = await confirm({
        title: 'Apply this to existing mail?',
        description:
          `This matches at least ${count} conversation${created.matchCount === 1 ? '' : 's'} ` +
          'already in this mailbox. Applying runs in the background and every change can be ' +
          'reversed from the conversation it changed.',
        confirmText: 'Apply now',
        cancelText: 'Only new mail',
      })
      if (confirmed) {
        await applyRetroactively.mutateAsync({ filterId: created.filterId })
      }
    }
    return true
  }

  const runAccept = () => {
    void (async () => {
      try {
        await acceptFilter()
        invalidate()
      } catch (error) {
        toastError({
          title: 'Error creating the filter',
          description: error instanceof Error ? error.message : 'Please try again.',
        })
      }
    })()
  }

  const runUnsubscribeAndArchive = () => {
    void (async () => {
      if (suggestion.isSharedInbox) {
        const confirmed = await confirm({
          title: 'Unsubscribe this shared mailbox?',
          description:
            `This stops these emails for everyone using ${suggestion.inboxName}, and it cannot ` +
            'be undone from here — resubscribing means signing up again with the sender.',
          confirmText: 'Unsubscribe',
          cancelText: 'Cancel',
          destructive: true,
        })
        if (!confirmed) return
      }

      try {
        const outcome = await unsubscribe.mutateAsync({ suggestionId: suggestion.id })

        // A refusal is an OUTCOME, not a failure: the card swaps to the
        // block-sender alternative and the filter half is still worth doing.
        if (outcome.status === 'refused') {
          setRefusal(outcome.refusal.message)
        } else if (outcome.status === 'requested' && outcome.openUrl) {
          // The `http` tier: we never POST that URL, the user opens it. A blocked
          // popup becomes a link on the card rather than nothing at all.
          const opened = window.open(outcome.openUrl, '_blank', 'noopener,noreferrer')
          if (!opened) setPendingOpenUrl(outcome.openUrl)
        }

        // S10 — the filter is the half that works immediately, so it runs even
        // when the unsubscribe was refused or the sender ignores it.
        if (suggestion.canAuthorFilter) await acceptFilter()
        invalidate()
      } catch (error) {
        toastError({
          title: 'Error unsubscribing',
          description: error instanceof Error ? error.message : 'Please try again.',
        })
      }
    })()
  }

  const runDismiss = () => {
    dismiss.mutate(
      { suggestionId: suggestion.id },
      {
        onSuccess: () => invalidate(),
        onError: (error) => toastError({ title: 'Error dismissing', description: error.message }),
      }
    )
  }

  /**
   * Block the sender on the channel.
   *
   * Always confirms, and never quietly — this is the most destructive answer the
   * card offers. Blocking is CHANNEL-scoped, so it reaches every inbox that
   * channel feeds, not just this one; and it is prevention, so future mail never
   * lands as a thread at all rather than landing and being moved. The server
   * blocks the specific from-address (never the group's domain) and the confirm
   * names that address so nobody blocks `gmail.com` by accident.
   */
  const runBlockSender = () => {
    void (async () => {
      const confirmed = await confirm({
        title: 'Block this sender?',
        description:
          `Mail from the address behind ${describeSubjectKey(suggestion.subjectKey)} will be ` +
          'rejected on the channel before it reaches any mailbox, and mail already here is ' +
          'marked ignored. Only that exact address is blocked, never the whole domain. This ' +
          'affects everyone using that channel, and you can undo it in channel settings.',
        confirmText: 'Block sender',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (!confirmed) return

      try {
        await blockSender.mutateAsync({ suggestionId: suggestion.id })
        invalidate()
      } catch (error) {
        toastError({
          title: 'Error blocking the sender',
          description: error instanceof Error ? error.message : 'Please try again.',
        })
      }
    })()
  }

  return {
    runAccept,
    runUnsubscribeAndArchive,
    runDismiss,
    runBlockSender,
    isBlocking: blockSender.isPending,
    isPending,
    refusal,
    pendingOpenUrl,
    ConfirmDialog,
  }
}
