// apps/web/src/components/inbox/ui/mail-classification-retroactive-prompt.tsx

'use client'

import { Alert } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { Sparkles, X } from 'lucide-react'
import { useState } from 'react'
import { api } from '~/trpc/react'
import { InboxReclassifyDialog } from './inbox-reclassify-dialog'

/**
 * "Classify N existing conversations?" — the post-sync prompt (07 §3.4).
 *
 * §2.9 names two triggers for retroactive classification, and this is the
 * second. The first — the backlog row on the inbox's classification card — only
 * reaches someone who goes into settings. An inbox that finished syncing last
 * week has no completion event left to hang anything on, so without this the
 * feature is discoverable only by accident.
 *
 * Mounted in the mail UI rather than in settings, for the reason
 * `MailFilterRetroactivePrompt`'s own doc comment gives and which applies here
 * unchanged: *the person who should answer is the one looking at the mail*.
 *
 * ⚠️ **It opens the scope dialog; it never starts a run** (07 invariant 12 and
 * R1). The equivalent filter prompt has an "Apply now" button because its action
 * is free. This one spends money per conversation, and a banner that bills you
 * on one click is the dark pattern §2.9 refuses. The affordance is a question
 * that leads to a confirm with a cost on it.
 *
 * ⚠️ **It says filters will not run** (R5 / invariant 11). "Classify existing
 * mail" reads as "apply my automations to old mail" to most people, and the
 * honest correction belongs at the point of action, not in a tooltip.
 */
export function MailClassificationRetroactivePrompt({
  activeInboxId,
}: {
  /**
   * The inbox being VIEWED, when the current mail context is one inbox. Only a
   * preference — the server reorders its candidates and still asks about
   * another inbox when this one has no backlog, so search / drafts / all-inboxes
   * (which pass nothing) keep the prompt. Without it the banner sits in the same
   * slot for every view and names whichever inbox sorted first, which reads as a
   * claim about the mail on screen.
   */
  activeInboxId?: string
}) {
  const utils = api.useUtils()
  const [dialogOpen, setDialogOpen] = useState(false)

  const { data: prompt } = api.mailClassification.pendingRetroactivePrompt.useQuery(
    { inboxId: activeInboxId },
    { staleTime: 60_000 }
  )

  /**
   * ⚠️ **07 §3.4 — TWO PROMPTS MUST NEVER STACK.**
   *
   * Both banners mount in the same slot above the thread list, and two stacked
   * blue alerts asking for two different things is how a user learns to dismiss
   * banners without reading them.
   *
   * The filter prompt wins, for two reasons the plan gives: it is the older
   * feature, and its action actually mutates routing — assign, archive, answer —
   * whereas this one only labels. Deferring the cheaper, more reversible
   * question is the right way round.
   *
   * The same query key the filter prompt uses, with the same `staleTime`, so
   * this is a cache read rather than a second request.
   */
  const { data: filterPrompt } = api.mailFilters.pendingRetroactivePrompt.useQuery(undefined, {
    staleTime: 60_000,
  })

  const dismiss = api.mailClassification.dismissRetroactivePrompt.useMutation({
    onSuccess: () => utils.mailClassification.pendingRetroactivePrompt.invalidate(),
    onError: (error) =>
      toastError({ title: 'Error dismissing the prompt', description: error.message }),
  })

  if (!prompt) return null
  if (filterPrompt) return null

  const threadCount = prompt.threadCountCapped
    ? `${prompt.threadCount.toLocaleString()}+`
    : prompt.threadCount.toLocaleString()
  const inboxName = prompt.inboxName || 'this inbox'

  return (
    <>
      <div className='shrink-0 bg-secondary px-2 pt-2 max-sm:dark:bg-primary-100 sm:dark:bg-muted-50'>
        <Alert variant='blue' className='flex flex-col gap-2 sm:flex-row sm:items-center'>
          <div className='flex min-w-0 flex-1 items-start gap-2'>
            <Sparkles className='mt-0.5 size-4 shrink-0' />
            <div className='min-w-0'>
              <p className='font-medium'>
                Classify {threadCount} existing{' '}
                {prompt.threadCount === 1 ? 'conversation' : 'conversations'} in {inboxName}?
              </p>
              <p className='text-xs opacity-80'>
                {/* R5 / invariant 11 — REQUIRED copy, not decoration. */}
                Categories only get applied to mail that arrives after you turned this on. Labelling
                older mail makes it searchable and reportable.{' '}
                <strong className='font-medium'>Your filters will not run on it</strong> — nothing
                is assigned, archived or answered.
              </p>
            </div>
          </div>
          <div className='flex shrink-0 items-center gap-1 self-end sm:self-auto'>
            {/* Opens the scope dialog — which states the count and the estimated
                cost before anything is spent. Never a one-click run. */}
            <Button variant='outline' size='sm' onClick={() => setDialogOpen(true)}>
              Choose what to classify
            </Button>
            <Button
              variant='ghost'
              size='sm'
              disabled={dismiss.isPending}
              onClick={() => dismiss.mutate({ inboxId: prompt.inboxId })}>
              <X />
              <span className='sr-only'>Dismiss</span>
            </Button>
          </div>
        </Alert>
      </div>

      <InboxReclassifyDialog
        inboxId={prompt.inboxId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </>
  )
}
