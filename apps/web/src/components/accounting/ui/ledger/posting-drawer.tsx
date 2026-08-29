// apps/web/src/components/accounting/ui/ledger/posting-drawer.tsx

'use client'

import { type PostingAssertions, reverseAssertions } from '@auxx/lib/postings/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import { Label } from '@auxx/ui/components/label'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { Textarea } from '@auxx/ui/components/textarea'
import { BookOpenCheck, Layers, Undo2 } from 'lucide-react'
import { useState } from 'react'
import {
  FIXTURE_POST_RESULT,
  FIXTURE_POST_RESULT_NOT_CONNECTED,
  FIXTURE_POSTED_DRAFT,
  FIXTURE_REVISIONS,
  type FixtureRevision,
} from '~/components/accounting/fixtures'
import { EntryJournal } from './entry-journal'
import { EntryRollForward } from './entry-roll-forward'
import { formatAuditTimestamp, formatPeriodLabel } from './format'
import { PostResultCallout } from './post-result-callout'

/** Flatten the fixture chain so a `?posting=<id>` deep link resolves from any month. */
function findRevision(
  glPostingId: string
): { periodKey: string; revision: FixtureRevision } | null {
  for (const [periodKey, revisions] of Object.entries(FIXTURE_REVISIONS)) {
    const revision = revisions.find((candidate) => candidate.glPostingId === glPostingId)
    if (revision) return { periodKey, revision }
  }
  return null
}

interface PostingDrawerProps {
  /** From `?posting=<id>`. `null` closes the drawer. */
  postingId: string | null
  /**
   * The revision chain of the month currently on screen, checked before the
   * global fixture map so a period that has never been reversed still resolves.
   */
  chain?: FixtureRevision[]
  /** The period `chain` belongs to. */
  chainPeriodKey?: string
  onOpenChange: (open: boolean) => void
  isDocked: boolean
  width: number
  onWidthChange: (width: number) => void
  currencyCode: string
  bookTimeZone: string
  providerLabel: string
  providerConnected: boolean
}

/**
 * One posting, deep-linked on `?posting=<id>`.
 *
 * `DockableDrawer` rather than `RecordDrawer`: `RecordDrawer` is entity-driven
 * and `GlPosting` is a Drizzle table, which was the whole point of decision
 * `G6`. The analogue is the workflow execution detail drawer: a non-entity,
 * table-backed detail panel opened from a list (13-accounting-ui.md §1).
 *
 * 🛑 The URL matters. A ledger entry is the thing somebody pastes into Slack
 * asking "why is this three thousand dollars high", and a drawer with no URL
 * cannot be linked to. On an auditable surface that is a real loss.
 *
 * ⚠️ This renders the STORED draft, never a re-run of the builder. Re-deriving
 * gives a different answer the moment the subledger moves, and the number that
 * matters is the one that was posted.
 */
export function PostingDrawer({
  postingId,
  chain: chainProp,
  chainPeriodKey,
  onOpenChange,
  isDocked,
  width,
  onWidthChange,
  currencyCode,
  bookTimeZone,
  providerLabel,
  providerConnected,
}: PostingDrawerProps) {
  const [memo, setMemo] = useState('')
  const [isReversing, setIsReversing] = useState(false)

  const fromChain =
    postingId && chainProp && chainPeriodKey
      ? chainProp.find((candidate) => candidate.glPostingId === postingId)
      : undefined
  const found = fromChain
    ? { periodKey: chainPeriodKey as string, revision: fromChain }
    : postingId
      ? findRevision(postingId)
      : null
  const revision = found?.revision
  const periodKey = found?.periodKey ?? ''
  const chain =
    fromChain && chainProp ? chainProp : periodKey ? (FIXTURE_REVISIONS[periodKey] ?? []) : []

  // PLACEHOLDER derivation. A reversal is the revision that sits directly above
  // a reversed one; the real `ledger.get(id)` carries the posting type, so this
  // guess goes away with the fixtures.
  const below = revision
    ? chain.find((candidate) => candidate.revision === revision.revision - 1)
    : undefined
  const isReversal = below?.status === 'reversed'

  // 🛑 A reversal's assertions are the original's, SWAPPED, read off frozen
  // data, never by re-running the month-end reader against the prior-prior
  // period, which would pick up movements that arrived after the original
  // posted.
  const storedAssertions: PostingAssertions | undefined = FIXTURE_POSTED_DRAFT.assertions
  const assertions =
    storedAssertions && isReversal ? reverseAssertions(storedAssertions) : storedAssertions

  const postResult = providerConnected ? FIXTURE_POST_RESULT : FIXTURE_POST_RESULT_NOT_CONNECTED

  function handleReverse() {
    // PLACEHOLDER: becomes `ledger.reverse({ glPostingId, memo })`.
    setIsReversing(true)
    setTimeout(() => {
      setIsReversing(false)
      setMemo('')
      onOpenChange(false)
    }, 550)
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
      title={revision ? `Posting ${revision.docNumber}` : 'Posting'}>
      <div className='flex min-h-0 flex-1 flex-col rounded-t-xl'>
        <DrawerHeader
          icon={<BookOpenCheck className='size-5 text-muted-foreground' />}
          title={
            <div className='flex flex-wrap items-center gap-2'>
              <span className='font-mono font-medium'>{revision?.docNumber ?? 'Posting'}</span>
              {revision && (
                <>
                  <Badge variant='outline' size='sm'>
                    Revision {revision.revision}
                  </Badge>
                  <Badge variant={revision.status === 'reversed' ? 'outline' : 'green'} size='sm'>
                    {revision.status === 'reversed' ? 'Reversed' : 'Posted'}
                  </Badge>
                </>
              )}
            </div>
          }
          onClose={() => onOpenChange(false)}
        />

        {!revision ? (
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
                  <span>{formatPeriodLabel(periodKey)}</span>
                </div>
                <div className='flex justify-between gap-4'>
                  <span className='text-muted-foreground'>Posted</span>
                  <span>{formatAuditTimestamp(revision.postedAt, bookTimeZone)}</span>
                </div>
                {revision.memo && (
                  <div className='flex justify-between gap-4'>
                    <span className='shrink-0 text-muted-foreground'>Memo</span>
                    <span className='text-right'>{revision.memo}</span>
                  </div>
                )}
              </div>

              <Section
                title='Journal entry'
                icon={<BookOpenCheck className='size-4' />}
                description='The stored draft, exactly as it was posted.'
                collapsible={false}>
                <EntryJournal
                  lines={FIXTURE_POSTED_DRAFT.resolvedLines}
                  currencyCode={currencyCode}
                />
              </Section>

              {assertions && (
                <Section
                  title={isReversal ? 'Roll-forward (swapped)' : 'Roll-forward'}
                  icon={<Layers className='size-4' />}
                  description={
                    isReversal
                      ? 'A reversal asserts the original pair the other way round, so its opening is the original closing.'
                      : 'What this entry asserted about the world on either side of itself.'
                  }
                  collapsible={false}>
                  <EntryRollForward assertions={assertions} currencyCode={currencyCode} />
                </Section>
              )}

              <div className='px-1'>
                <PostResultCallout result={postResult} providerLabel={providerLabel} />
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
                      disabled={memo.trim().length === 0 || revision.status === 'reversed'}
                      loading={isReversing}
                      loadingText='Reversing...'
                      onClick={handleReverse}>
                      <Undo2 />
                      Reverse
                    </Button>
                  </div>
                  {revision.status === 'reversed' && (
                    <p className='text-xs text-muted-foreground'>
                      This revision has already been reversed.
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
