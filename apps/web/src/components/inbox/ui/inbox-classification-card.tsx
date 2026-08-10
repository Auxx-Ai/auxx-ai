// apps/web/src/components/inbox/ui/inbox-classification-card.tsx

'use client'

import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { ToggleCard } from '@auxx/ui/components/toggle-card'
import { Sparkles, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { SettingsSection } from '~/components/global/settings-page'
import { api } from '~/trpc/react'
import { InboxReclassifyRow } from './inbox-reclassify-row'

/**
 * The per-inbox mail-classification opt-in
 * (`plans/mail-filter/05-mail-classification-plan.md` §6.4).
 *
 * Rendered only for callers who may author automation on this inbox — the
 * parent decides that from `mailFilters.authorableInboxes`, which is the SAME
 * authority the router asserts, so the card can never be offered where the
 * write would be refused.
 *
 * Three things this card must say out loud, because each is a question a user
 * would otherwise have to guess at:
 *
 * - **What the AI reads.** "Does AI read my mail" deserves a straight answer,
 *   in the place where the answer changes. Subject, sender, the start of the
 *   body, inbound only, this inbox only.
 * - **Whether it can do anything.** The classifier only ever applies tags that
 *   are marked AI-eligible (C8's second guard). With none marked, arming the
 *   inbox is completely inert — so the switch is disabled and says why, rather
 *   than flipping on and looking like it worked.
 * - **What it costs.** Metered per inbound message, zero on your own key.
 * - **Whether it is currently working.** With the balance empty every inbound
 *   message fails its model call and is left untagged — and because the
 *   classifier runs in the background, nobody finds out. Every other AI surface
 *   reports this by interrupting a human mid-action; this one has no human to
 *   interrupt, so the card has to say it.
 */
export function InboxClassificationCard({ inboxId }: { inboxId: string }) {
  const utils = api.useUtils()
  const { data, isPending } = api.mailClassification.getInboxSettings.useQuery({ inboxId })

  const setClassification = api.mailClassification.setInboxEnabled.useMutation({
    onSuccess: () => utils.mailClassification.getInboxSettings.invalidate({ inboxId }),
    onError: (error) => {
      toastError({ title: 'Error updating AI classification', description: error.message })
    },
  })

  if (isPending || !data) {
    return (
      <SettingsSection icon={Sparkles} title='AI classification'>
        <Skeleton className='h-20 w-full rounded-xl' />
      </SettingsSection>
    )
  }

  const { enabled, eligibleTagCount, creditsExhausted } = data
  const hasEligibleTags = eligibleTagCount > 0

  return (
    <SettingsSection
      icon={Sparkles}
      title='AI classification'
      description='Let Auxx categorise new mail in this inbox by applying your tags.'>
      {/* Only when it is actually costing something: an inbox that is switched
          off is not being stopped by anything, and saying so there would just be
          noise on a page nobody came to for billing. */}
      {enabled && creditsExhausted ? (
        <Alert variant='warning' className='mb-3'>
          <TriangleAlert />
          <AlertDescription>
            Classification is paused. Your organization is out of AI credits. Incoming mail is being
            delivered as normal but is not being tagged. Credits refill at the start of your next
            billing cycle, and mail that arrives before then is not classified later.
          </AlertDescription>
        </Alert>
      ) : null}
      <ToggleCard
        title='Classify incoming mail'
        icon={<Sparkles className='size-3.5' />}
        checked={enabled}
        // Turning it on with nothing to apply would do nothing at all — and a
        // switch that flips on and changes nothing is worse than one that
        // explains itself.
        disabled={setClassification.isPending || (!enabled && !hasEligibleTags)}
        onCheckedChange={(next) => setClassification.mutate({ inboxId, enabled: next })}
        // The description carries a link, so a click anywhere must not also
        // toggle the switch.
        rowClickToggles={false}
        description={
          <>
            <span className='block'>
              Auxx sends the subject, the sender and the first part of the message body of each new
              incoming message <strong className='font-medium'>in this inbox only</strong> to the AI
              model, and applies a matching tag. Mail in other inboxes, older conversations and your
              replies are never sent.
            </span>
            <span className='mt-1 block'>
              {hasEligibleTags ? (
                <>
                  {eligibleTagCount} {eligibleTagCount === 1 ? 'tag is' : 'tags are'} eligible.{' '}
                  <Link href='/app/settings/tags' className='underline underline-offset-2'>
                    Manage which tags AI may apply
                  </Link>
                  .
                </>
              ) : (
                <>
                  No tags are eligible yet, so this would do nothing.{' '}
                  <Link href='/app/settings/tags' className='underline underline-offset-2'>
                    Mark a tag as AI-applicable
                  </Link>{' '}
                  first.
                </>
              )}
            </span>
            <span className='mt-1 block'>
              Metered per incoming message. Free when you bring your own API key.
            </span>
          </>
        }
      />
      {/* The backlog row (07 §3.1) — only once the toggle is on, because the
          classifier's own double guard (C8) means a switched-off inbox has
          nothing it may legally run. It hides itself when there is no backlog.
          ⚠️ Enabling the toggle makes it appear immediately; that IS the prompt,
          and the cost dialog is never auto-opened (07 invariant 12). */}
      {enabled ? <InboxReclassifyRow inboxId={inboxId} /> : null}
    </SettingsSection>
  )
}
