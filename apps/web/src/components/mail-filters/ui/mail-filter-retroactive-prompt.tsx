// apps/web/src/components/mail-filters/ui/mail-filter-retroactive-prompt.tsx

'use client'

import { Alert } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { Filter, X } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { api } from '~/trpc/react'

/**
 * "Apply your N filters to M existing conversations?" — the post-connect prompt
 * (D18, §7).
 *
 * A freshly connected mailbox backfills with filters OFF: `message:received` is
 * published only for `!ctx.isInitialSync`, so nothing mass-mutates a mailbox we
 * just met. That is the safe default, and it leaves the owner staring at an
 * unfiltered inbox — this is how they find out.
 *
 * **Never automatic.** A large unattended bulk mutation on a mailbox we have
 * barely finished reading is the operation you would least want to get wrong, so
 * the whole surface is one question with two answers. Saying yes goes through
 * `applyRetroactively`, which is paged, writes one `MailFilterRun` per thread,
 * and is undoable from the thread chips.
 *
 * Mounted in the mail UI rather than in settings: the person who should answer
 * is the one looking at the unfiltered mail.
 *
 * ⚠️ **"The one looking at the mail" was aspirational until the `activeInboxId`
 * preference landed.** The query took no inbox, so the banner named whichever
 * authorable inbox sorted first and rendered in a fixed slot above EVERY mail
 * view — putting a one-click bulk mutation on a mailbox the reader was not in.
 * See `07-…`§7.10.
 */
export function MailFilterRetroactivePrompt({
  activeInboxId,
}: {
  /**
   * The inbox being VIEWED, when the current mail context is one inbox. Only a
   * preference — the server reorders its candidates and still asks about
   * another inbox when this one has nothing pending, so search / drafts /
   * all-inboxes (which pass nothing) keep the prompt.
   */
  activeInboxId?: string
}) {
  const utils = api.useUtils()
  const [applying, setApplying] = useState(false)

  const { data: prompt } = api.mailFilters.pendingRetroactivePrompt.useQuery(
    { inboxId: activeInboxId },
    { staleTime: 60_000 }
  )
  // Scoped to the caller's authorable inboxes by the router, so this is the same
  // set the prompt is drawn from.
  const { data: filters } = api.mailFilters.list.useQuery(undefined, { enabled: !!prompt })

  const applyRetroactively = api.mailFilters.applyRetroactively.useMutation()
  const dismiss = api.mailFilters.dismissRetroactivePrompt.useMutation({
    onSuccess: () => utils.mailFilters.pendingRetroactivePrompt.invalidate(),
    onError: (error) =>
      toastError({ title: 'Error dismissing the prompt', description: error.message }),
  })

  if (!prompt) return null

  /**
   * The prompt counts filters but does not name them, so resolve the ids here
   * and enqueue them **in evaluation order** — the order the engine would have
   * applied them in live, which is what makes `stopProcessing` mean the same
   * thing on a backfill as it does on arrival.
   */
  const applicable = (filters ?? [])
    .filter((filter) => filter.inboxId === prompt.inboxId && filter.enabled)
    .sort((a, b) => a.order - b.order)

  const handleApply = async () => {
    if (applicable.length === 0) return
    setApplying(true)
    try {
      for (const filter of applicable) {
        await applyRetroactively.mutateAsync({ filterId: filter.id })
      }
      // The prompt never asks again once a retroactive run exists, but the jobs
      // are only enqueued here — dismiss for this user so the banner goes away
      // now rather than when the first job lands.
      await dismiss.mutateAsync({ inboxId: prompt.inboxId })
    } catch (error) {
      toastError({
        title: 'Error applying filters to existing mail',
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    } finally {
      setApplying(false)
      void utils.mailFilters.pendingRetroactivePrompt.invalidate()
    }
  }

  const threadCount = prompt.threadCountCapped ? `${prompt.threadCount}+` : `${prompt.threadCount}`
  const filterLabel = prompt.filterCount === 1 ? 'filter' : 'filters'
  const inboxName = prompt.inboxName || 'this inbox'

  /**
   * ⚠️ **One click only applies to the mailbox you are looking at.**
   *
   * The preference above makes a mismatch rare, not impossible — a view that
   * spans inboxes passes no id at all, and the inbox you are in may have nothing
   * pending while another does. In those cases the banner is still worth showing
   * (that is the whole discovery argument), but "Apply now" is not: this button
   * assigns, archives and moves across a whole mailbox's history, and offering
   * that in one click for a mailbox that is not on screen is the mistake this
   * component's own doc comment warns about.
   *
   * So off-target, the action degrades to navigation. Same question, same
   * banner — you just have to be looking at the mail before you can mutate it.
   */
  const isActiveInbox = prompt.inboxId === activeInboxId
  const inboxHref = prompt.isPersonal
    ? `/app/mail/personal/${prompt.inboxId}/open`
    : `/app/mail/inboxes/${prompt.inboxId}/unassigned`

  return (
    <div className='shrink-0 bg-secondary px-2 pt-2 max-sm:dark:bg-primary-100 sm:dark:bg-muted-50'>
      <Alert variant='blue' className='flex flex-col gap-2 sm:flex-row sm:items-center'>
        <div className='flex min-w-0 flex-1 items-start gap-2'>
          <Filter className='mt-0.5 size-4 shrink-0' />
          <div className='min-w-0'>
            <p className='font-medium'>
              Apply your {prompt.filterCount} {filterLabel} to {threadCount} existing conversations
              in {inboxName}?
            </p>
            <p className='text-xs opacity-80'>
              Filters only run on mail that arrives after they were created, so everything already
              in this mailbox is untouched. This runs in the background and every change can be
              reversed from the conversation it changed.
            </p>
          </div>
        </div>
        <div className='flex shrink-0 items-center gap-1 self-end sm:self-auto'>
          {isActiveInbox ? (
            <Button
              variant='outline'
              size='sm'
              loading={applying}
              loadingText='Starting...'
              disabled={applicable.length === 0}
              onClick={() => void handleApply()}>
              Apply now
            </Button>
          ) : (
            <Button variant='outline' size='sm' asChild>
              <Link href={inboxHref}>Review in {inboxName}</Link>
            </Button>
          )}
          <Button
            variant='ghost'
            size='sm'
            disabled={applying}
            onClick={() => dismiss.mutate({ inboxId: prompt.inboxId })}>
            <X />
            <span className='sr-only'>Dismiss</span>
          </Button>
        </div>
      </Alert>
    </div>
  )
}
