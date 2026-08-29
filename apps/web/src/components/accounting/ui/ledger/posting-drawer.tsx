// apps/web/src/components/accounting/ui/ledger/posting-drawer.tsx

'use client'

import type { PostingDetail, PostResult } from '@auxx/lib/postings/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import { Label } from '@auxx/ui/components/label'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Textarea } from '@auxx/ui/components/textarea'
import { BookOpenCheck, Layers, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { api } from '~/trpc/react'
import { EntryJournal, journalLinesFromDetail } from './entry-journal'
import { EntryRollForward } from './entry-roll-forward'
import { formatAuditTimestamp, formatPeriodLabel } from './format'
import { PostResultCallout } from './post-result-callout'
import { readStoredAssertions } from './stored-draft'

interface PostingDrawerProps {
  /** From `?posting=<id>`. `null` closes the drawer. */
  postingId: string | null
  onOpenChange: (open: boolean) => void
  /** Follow a link to another posting - the one this reversal reverses. */
  onSelectPosting: (glPostingId: string) => void
  isDocked: boolean
  width: number
  onWidthChange: (width: number) => void
  currencyCode: string
  bookTimeZone: string
  providerLabel: string
  /** Reverse this posting with a memo. Owned by the caller's actions hook. */
  onReverse: (memo: string) => void
  isReversing: boolean
}

/**
 * One posting, deep-linked on `?posting=<id>`, read in a single `ledger.get`
 * call.
 *
 * `DockableDrawer` rather than `RecordDrawer`: `RecordDrawer` is entity-driven
 * and `GlPosting` is a Drizzle table, which was the whole point of decision
 * `G6`. The analogue is the workflow execution detail drawer: a non-entity,
 * table-backed detail panel opened from a list (13-accounting-ui.md section 1).
 *
 * 🛑 The URL matters. A ledger entry is the thing somebody pastes into Slack
 * asking "why is this three thousand dollars high", and a drawer with no URL
 * cannot be linked to. On an auditable surface that is a real loss.
 *
 * ⚠️ Everything here is the STORED record, never a re-run of the builder. The
 * lines come from `GlPostingLine` with the account name as it stood at posting
 * time, and the roll-forward comes from the stored draft's assertions - already
 * swapped by `reverseEntry` when this posting is a reversal, so nothing swaps
 * them again here. Re-deriving either would give a different answer the moment
 * the subledger moves, and the number that matters is the one that was posted.
 */
export function PostingDrawer({
  postingId,
  onOpenChange,
  onSelectPosting,
  isDocked,
  width,
  onWidthChange,
  currencyCode,
  bookTimeZone,
  providerLabel,
  onReverse,
  isReversing,
}: PostingDrawerProps) {
  const [memo, setMemo] = useState('')

  const postingQuery = api.ledger.get.useQuery(
    { id: postingId ?? '' },
    { enabled: !!postingId, staleTime: 30_000 }
  )
  const detail = postingQuery.data

  const assertions = detail ? readStoredAssertions(detail.draft) : null
  const isReversal = !!detail?.reversesId

  function handleReverse() {
    onReverse(memo)
    setMemo('')
  }

  return (
    <DockableDrawer
      open={!!postingId}
      onOpenChange={onOpenChange}
      isDocked={isDocked}
      width={width}
      onWidthChange={onWidthChange}
      minWidth={380}
      maxWidth={720}
      title={detail ? `Posting ${detail.docNumber}` : 'Posting'}>
      <div className='flex min-h-0 flex-1 flex-col rounded-t-xl'>
        <DrawerHeader
          icon={<BookOpenCheck className='size-5 text-muted-foreground' />}
          title={
            <div className='flex flex-wrap items-center gap-2'>
              <span className='font-mono font-medium'>{detail?.docNumber ?? 'Posting'}</span>
              {detail && (
                <>
                  <Badge variant='outline' size='sm'>
                    Revision {detail.revision}
                  </Badge>
                  <Badge variant={detail.status === 'posted' ? 'green' : 'outline'} size='sm'>
                    {STATUS_LABEL[detail.status]}
                  </Badge>
                </>
              )}
            </div>
          }
          onClose={() => onOpenChange(false)}
        />

        {postingQuery.isPending && postingId ? (
          <div className='flex flex-col gap-2 p-4'>
            <Skeleton className='h-20 w-full' />
            <Skeleton className='h-40 w-full' />
          </div>
        ) : !detail ? (
          <div className='p-4 text-sm text-muted-foreground'>
            No posting matches this link. It may have been reversed and re-entered under a new
            revision.
          </div>
        ) : (
          <ScrollArea className='min-h-0 flex-1' scrollbarClassName='w-1.5'>
            <div className='flex flex-col gap-2 p-3'>
              <div className='flex flex-col gap-1 rounded-lg border bg-muted/30 p-3 text-sm'>
                <div className='flex justify-between gap-4'>
                  <span className='text-muted-foreground'>Period</span>
                  <span>{formatPeriodLabel(detail.periodKey)}</span>
                </div>
                <div className='flex justify-between gap-4'>
                  <span className='text-muted-foreground'>Posted</span>
                  <span>
                    {detail.postedAt
                      ? formatAuditTimestamp(detail.postedAt, bookTimeZone)
                      : 'Not in the books yet'}
                  </span>
                </div>
                {isReversal && (
                  <div className='flex justify-between gap-4'>
                    <span className='shrink-0 text-muted-foreground'>Reverses</span>
                    <Button
                      variant='link'
                      size='sm'
                      className='h-auto p-0'
                      onClick={() => detail.reversesId && onSelectPosting(detail.reversesId)}>
                      <span className='font-mono text-xs'>{detail.reversesId}</span>
                    </Button>
                  </div>
                )}
              </div>

              <Section
                title='Journal entry'
                icon={<BookOpenCheck className='size-4' />}
                description='The stored lines, exactly as they were posted.'
                collapsible={false}>
                <EntryJournal
                  lines={journalLinesFromDetail(detail.lines)}
                  currencyCode={currencyCode}
                />
              </Section>

              {assertions && (
                <Section
                  title={isReversal ? 'Roll-forward (swapped)' : 'Roll-forward'}
                  icon={<Layers className='size-4' />}
                  description={
                    isReversal
                      ? 'A reversal asserts the original pair the other way round, so its opening is the original closing. Stored that way, not swapped on read.'
                      : 'What this entry asserted about the world on either side of itself.'
                  }
                  collapsible={false}>
                  <EntryRollForward assertions={assertions} currencyCode={currencyCode} />
                </Section>
              )}

              <div className='px-1'>
                <PostResultCallout
                  result={providerResultFromDetail(detail)}
                  providerLabel={providerLabel}
                />
              </div>

              <Section
                title='Reverse this posting'
                icon={<Undo2 className='size-4' />}
                description='A mistake is corrected by reversing and re-entering, never by editing a posted entry.'
                collapsible={false}>
                <div className='flex flex-col gap-2'>
                  <Label htmlFor='reversal-memo'>Why is it being reversed?</Label>
                  <Textarea
                    id='reversal-memo'
                    value={memo}
                    onChange={(event) => setMemo(event.target.value)}
                    placeholder='This memo is carried onto the reversing entry and is the only explanation a reader gets later.'
                    rows={3}
                  />
                  <div>
                    <Button
                      variant='outline'
                      size='sm'
                      disabled={memo.trim().length === 0 || detail.status !== 'posted'}
                      loading={isReversing}
                      loadingText='Reversing...'
                      onClick={handleReverse}>
                      <Undo2 />
                      Reverse
                    </Button>
                  </div>
                  {detail.status !== 'posted' && (
                    <p className='text-xs text-muted-foreground'>
                      Only a posted entry can be reversed. This one is{' '}
                      {STATUS_LABEL[detail.status].toLowerCase()}.
                    </p>
                  )}
                </div>
              </Section>
            </div>
          </ScrollArea>
        )}
      </div>
    </DockableDrawer>
  )
}

const STATUS_LABEL: Record<PostingDetail['status'], string> = {
  pending: 'In flight',
  posted: 'Posted',
  failed: 'Failed',
  reversed: 'Reversed',
}

/**
 * What happened at the provider, reconstructed from the STORED row.
 *
 * ⚠️ A stored `GlPosting` records the outcome, not which of the success paths
 * produced it: `posted`, `already_posted` and `healed` all leave the same row
 * behind, so this reports `posted` for all three. It never invents a failure -
 * `failureReason` is rendered verbatim when the row actually failed - and it
 * keeps `not_connected` and `disabled` apart, which is the distinction decision
 * `P1` cares about: one is a missing integration, the other is a setting
 * somebody can flip, and merging them makes the remedy unguessable.
 */
function providerResultFromDetail(detail: {
  status: string
  docNumber: string
  providerId: string | null
  providerEntryId: string | null
  failureReason: string | null
}): PostResult {
  const providerId = detail.providerId ?? undefined
  const base = { docNumber: detail.docNumber, providerId }

  if (detail.status === 'failed') {
    return { ...base, status: 'error', error: detail.failureReason ?? undefined }
  }
  if (detail.providerEntryId) {
    return { ...base, status: 'posted', providerEntryId: detail.providerEntryId }
  }
  if (!providerId || providerId === 'none') {
    return { ...base, status: 'not_connected' }
  }
  return { ...base, status: 'disabled' }
}
