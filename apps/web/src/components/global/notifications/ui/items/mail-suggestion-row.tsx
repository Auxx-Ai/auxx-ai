// apps/web/src/components/global/notifications/ui/items/mail-suggestion-row.tsx

'use client'

import { Inbox } from 'lucide-react'
import { BlockCardActionButton } from '~/components/kopilot/ui/blocks/block-card'
import { useMailSuggestionActions } from '~/components/mail-suggestions/hooks/use-mail-suggestion-actions'
import type { MailSuggestionCard } from '~/components/mail-suggestions/hooks/use-mail-suggestions'
import {
  MailSuggestionNotice,
  MailSuggestionSummary,
  mailSuggestionButtonSpec,
} from '~/components/mail-suggestions/ui/mail-suggestion-content'
import { NotificationRow } from '../notification-row'

/**
 * One mined mail suggestion, triaged inline in the Approvals tab's fourth
 * section (plans/mail-filter/03-suggestions-plan.md §8.2).
 *
 * A sibling of `ConfirmationRow` / `AccessRequestRow` / `SuggestionRow` rather
 * than a mode of one: the payload is *a mailing list and 90 days of evidence*,
 * the answers are unsubscribe / filter / never-ask-again, and — unlike the other
 * three — **nothing here is backed by a `Notification` row**. The tab reads
 * source tables directly (plans/today/02-approvals-tab.md §2), and
 * `MailSuggestion` is one; minting a notification per card would create two
 * lifecycles over one thing.
 *
 * There is no read state and no delete, so `NotificationRow` is given neither:
 * dismissal is a status write on the source row and is permanent for that
 * sender.
 */
export function MailSuggestionRow({
  suggestion,
  onResolved,
}: {
  suggestion: MailSuggestionCard
  onResolved: () => void
}) {
  const actions = useMailSuggestionActions(suggestion, onResolved)
  const { ConfirmDialog } = actions
  const spec = mailSuggestionButtonSpec(suggestion)

  return (
    <>
      <NotificationRow
        id={suggestion.id}
        createdAt={new Date(suggestion.createdAt)}
        label='Mail suggestion'
        icon={<Inbox className='size-4' />}
        subtitle={suggestion.inboxName}
        actions={
          <>
            <BlockCardActionButton
              label='Dismiss'
              disabled={actions.isPending}
              onClick={actions.runDismiss}
            />
            {spec.secondaryLabel ? (
              <BlockCardActionButton
                label={spec.secondaryLabel}
                disabled={actions.isPending}
                onClick={actions.runAccept}
              />
            ) : null}
            {spec.primaryLabel ? (
              <BlockCardActionButton
                label={spec.primaryLabel}
                primary
                disabled={actions.isPending}
                onClick={
                  spec.primaryIsUnsubscribe ? actions.runUnsubscribeAndArchive : actions.runAccept
                }
              />
            ) : null}
          </>
        }>
        <MailSuggestionSummary suggestion={suggestion} />
        <MailSuggestionNotice
          suggestion={suggestion}
          refusal={actions.refusal}
          pendingOpenUrl={actions.pendingOpenUrl}
          onBlockSender={actions.runBlockSender}
          isBlocking={actions.isBlocking}
        />
      </NotificationRow>

      <ConfirmDialog />
    </>
  )
}
