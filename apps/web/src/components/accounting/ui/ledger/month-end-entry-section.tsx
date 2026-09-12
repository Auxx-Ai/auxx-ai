// apps/web/src/components/accounting/ui/ledger/month-end-entry-section.tsx

'use client'

import type { PostResult, ResolvedPostingLine } from '@auxx/lib/postings/client'
import { Button } from '@auxx/ui/components/button'
import { EmptySection, Section } from '@auxx/ui/components/section'
import { Separator } from '@auxx/ui/components/separator'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { BookOpenCheck, CircleSlash, Loader2, Send } from 'lucide-react'
import { EntryJournal } from './entry-journal'
import { PostResultCallout } from './post-result-callout'

interface MonthEndEntrySectionProps {
  periodLabel: string
  currencyCode: string
  /** The projected entry for an open month, or the STORED one for a posted month. */
  lines: ResolvedPostingLine[]
  docNumber: string | null | undefined
  /** The entry's own read is still in flight. */
  isLoading: boolean
  /** How many refusals stand between this month and a close. */
  blockerCount: number
  isPostedPeriod: boolean
  /** This session posted the month, so Post stops offering itself. */
  justPosted: boolean

  canPost: boolean
  isPosting: boolean
  onPost: () => void

  isPreviewing: boolean
  onRebuild: () => void

  postResult: PostResult | null
  providerLabel: string
  connectedTenantId: string | null
}

/**
 * THE month-end entry - one month, one entry, and the button that posts it.
 *
 * 🛑 Its own section, separate from `Entries`. The two were one section whose
 * header carried both Rebuild preview and New journal entry, which is two
 * different objects' controls in one strip: Rebuild rebuilds THIS entry, New
 * journal entry raises something that has nothing to do with it. The doc number
 * in the header belongs to this entry too, and read as the list's.
 *
 * 🛑 Under the L1 regime a month has exactly ONE month-end entry (no receipt,
 * build or shipment posts individually), so it renders inline with no list of
 * its own.
 *
 * 🛑 An OPEN month renders the projected entry from `ledger.previewMonthEnd`; a
 * POSTED month renders the STORED entry from `ledger.get`. They are never
 * crossed. Re-running the builder over a posted month gives a different answer
 * the moment the subledger moves, and the number that matters is the one that
 * was posted.
 */
export function MonthEndEntrySection({
  periodLabel,
  currencyCode,
  lines,
  docNumber,
  isLoading,
  blockerCount,
  isPostedPeriod,
  justPosted,
  canPost,
  isPosting,
  onPost,
  isPreviewing,
  onRebuild,
  postResult,
  providerLabel,
  connectedTenantId,
}: MonthEndEntrySectionProps) {
  return (
    <Section
      title='Month-end entry'
      icon={<BookOpenCheck className='size-4' />}
      secondary={docNumber ?? undefined}
      description={
        isPostedPeriod
          ? 'The stored entry, exactly as it was posted. Never a re-run of the builder.'
          : `The month-end inventory entry auxx would post for ${periodLabel}.`
      }
      collapsible={false}
      actions={
        !isPostedPeriod && (
          /* 🛑 The spinner is rendered here rather than through `loading`,
             because `Button` DISABLES a loading button - and a preview that
             never settles would then leave the only affordance that can refire
             it disabled, with a reload as the sole way out. Refiring is free:
             `previewMonthEnd` persists nothing, and the second answer replaces
             the first. */
          <Button variant='ghost' size='sm' onClick={onRebuild}>
            {isPreviewing ? (
              <>
                <Loader2 className='animate-spin' />
                Building...
              </>
            ) : (
              'Rebuild preview'
            )}
          </Button>
        )
      }>
      {isLoading && lines.length === 0 ? (
        <Skeleton className='h-48 w-full' />
      ) : lines.length === 0 ? (
        <EmptySection
          icon={<CircleSlash className='size-5' />}
          title='No entry was built'
          description={
            blockerCount > 0
              ? 'The refusals above are the whole of what happened.'
              : 'Nothing in this month produced a month-end entry.'
          }
        />
      ) : (
        <div className='flex flex-col gap-4'>
          {/* ⚠️ No drill-down affordance: the subledger report behind a line
              does not exist (section 7). `onDrillDown` is left off rather than
              opening an empty dialog. */}
          <EntryJournal lines={lines} currencyCode={currencyCode} />

          {postResult && (
            <PostResultCallout
              result={postResult}
              providerLabel={providerLabel}
              connectedTenantId={connectedTenantId}
            />
          )}

          {/* 🛑 POST lives HERE, beside the entry it acts on and directly under
              the totals and the balanced line. It is a decision taken against
              numbers somebody has just read, and moving it away would split
              "check it, then post it" into two motions on two surfaces.

              🛑 REVERSE is deliberately NOT here. It acts on a month that is
              already posted, so there is nothing on this screen to read before
              pressing it - it is a lifecycle act like the lock, and it lives
              with the lock in the rail's "Close the month" group. The pair are
              mutually exclusive in practice anyway (`canPost` requires an open
              month, Reverse requires a posting), so all this row ever showed on
              a posted month was a disabled Post button next to a sentence
              explaining why.

              ⚠️ The whole row goes with it: on a posted month there is nothing
              left to offer here. */}
          {!isPostedPeriod && !justPosted && (
            <div className='flex flex-wrap items-center gap-2 border-t pt-3'>
              {/* 🛑 `sm`, like every other button in the module. This and Lock
                  were the only `size='default'` controls on the screen, which
                  made the page's most consequential action look like a
                  different design system from the toolbar eight pixels above
                  it. Rank is carried by VARIANT - Post is the only filled
                  button on the page - not by size. */}
              <Button
                size='sm'
                disabled={!canPost}
                loading={isPosting}
                loadingText='Posting...'
                onClick={onPost}>
                <Send />
                Post {periodLabel}
              </Button>
              <Separator orientation='vertical' className='h-6' />
              <span className='text-xs text-muted-foreground'>
                {canPost
                  ? 'Posting records the entry here and pushes it to the accounting system, if one is connected.'
                  : 'Posting is refused until the blockers above are cleared.'}
              </span>
            </div>
          )}
        </div>
      )}
    </Section>
  )
}
