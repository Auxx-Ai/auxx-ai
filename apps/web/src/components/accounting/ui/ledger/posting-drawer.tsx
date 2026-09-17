// apps/web/src/components/accounting/ui/ledger/posting-drawer.tsx

'use client'

import type { PostingDetail, PostingType, PostResult } from '@auxx/lib/postings/client'
import { EXPORT_ROUTE_BY_POSTING_TYPE } from '@auxx/lib/postings/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import { Label } from '@auxx/ui/components/label'
import { MetricCell, MetricGrid } from '@auxx/ui/components/metric-grid'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError } from '@auxx/ui/components/toast'
import {
  BookOpenCheck,
  CalendarClock,
  CircleHelp,
  Clock,
  CloudOff,
  ExternalLink,
  Layers,
  Link2,
  Undo2,
} from 'lucide-react'
import { useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { EntryJournal, journalLinesFromDetail } from './entry-journal'
import { EntryRollForward } from './entry-roll-forward'
import { formatAuditTimestamp, formatPeriodLabel } from './format'
import { OUTCOMES, type OutcomeCopy, providerEntryUrl } from './post-result-callout'
import { readStoredAssertions, readStoredReasons, readStoredSources } from './stored-draft'

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
  /**
   * Which company this workspace is connected to now. Compared against the
   * posting's own tenant before a deep link is offered, and never rendered -
   * see `post-result-callout.tsx`.
   */
  connectedTenantId: string | null
  /** `ledger.control` (60 E5). Without it the provider link shows and Un-sync does not. */
  canUnsync: boolean
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
  connectedTenantId,
  canUnsync,
  onReverse,
  isReversing,
}: PostingDrawerProps) {
  const [memo, setMemo] = useState('')
  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()

  const postingQuery = api.ledger.get.useQuery(
    { id: postingId ?? '' },
    { enabled: !!postingId, staleTime: 30_000 }
  )
  const detail = postingQuery.data

  /**
   * The provider outcome, carried by the header status badge rather than by a
   * body callout: it is one sentence about an entry whose identity is already
   * in that strip, and an Alert for it pushed the journal below the fold.
   */
  const result = detail ? providerResultFromDetail(detail) : null
  const outcome = result ? OUTCOMES[result.status] : null
  const entryUrl = result?.providerEntryId
    ? providerEntryUrl(
        result.providerId,
        result.providerEntryId,
        result.providerTenantId ?? null,
        connectedTenantId
      )
    : null

  /** Nothing to put in the strip is an absent strip, not an empty flex row. */
  const headerActions =
    !!entryUrl || (canUnsync && detail?.exportStatus === 'exported') || detail?.status === 'posted'

  const assertions = detail ? readStoredAssertions(detail.draft) : null
  const reasons = detail ? readStoredReasons(detail.draft) : []
  const sources = detail ? readStoredSources(detail.draft) : []
  const isReversal = !!detail?.reversesId

  /**
   * 🛑 An EXPORT operation, not a ledger one (60 E1): their copy is deleted and
   * this entry stays posted, with its lines frozen and its effects claimed. The
   * button that backs an entry out of OUR books is Reverse, further down.
   */
  const unsyncExports = api.ledger.unsyncExports.useMutation({
    onSuccess: (result) => {
      const refused = result.outcomes.find((outcome) => outcome.status !== 'withdrawn')
      if (refused) {
        toastError({
          title: `Not removed from ${providerLabel}`,
          description: refused.message ?? 'It was not removed.',
        })
        return
      }
      void utils.ledger.get.invalidate()
      void utils.ledger.failedExports.invalidate()
      void utils.ledger.listPostings.invalidate()
    },
    onError: (mutationError) => {
      toastError({ title: 'Could not un-sync', description: mutationError.message })
    },
  })

  /** The confirm copy is 60 §8.2 verbatim, in its one-entry form. */
  async function handleUnsync() {
    if (!postingId) return
    const confirmed = await confirm({
      title: `Un-sync 1 entry from ${providerLabel}?`,
      description:
        `The journal entries we created there will be deleted. Your books are not changed — ` +
        `the entries stay posted here and return to Ready to sync, and they will not be sent ` +
        `again until you sync them.`,
      confirmText: 'Un-sync',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) unsyncExports.mutate({ glPostingIds: [postingId] })
  }

  function handleReverse() {
    onReverse(memo)
    setMemo('')
  }

  /**
   * The header has no memo field, so the confirm is what stands in for the
   * deliberation the section's textarea used to force.
   */
  async function handleHeaderReverse() {
    const confirmed = await confirm({
      title: 'Reverse this posting?',
      description:
        'A reversing entry is posted for the same amounts the other way round. Nothing here is edited or deleted, and you can add a memo from the Reverse section below instead.',
      confirmText: 'Reverse',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) handleReverse()
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
      title={detail ? `Posting ${detail.docNumber || '(draft)'}` : 'Posting'}>
      <div className='flex min-h-0 flex-1 flex-col rounded-t-xl'>
        <DrawerHeader
          icon={<BookOpenCheck className='size-5 text-muted-foreground' />}
          title={
            <div className='flex flex-wrap items-center gap-2'>
              <span className='font-mono font-medium'>{detail?.docNumber ?? 'Posting'}</span>
              {detail && outcome && (
                <>
                  <Badge variant='outline' size='sm'>
                    Revision {detail.revision}
                  </Badge>
                  <Tooltip
                    contentComponent={
                      <div className='flex max-w-64 flex-col gap-1'>
                        <span className='font-medium'>{outcome.title}</span>
                        <span>{outcome.detail}</span>
                        {result?.error && <span>{result.error}</span>}
                      </div>
                    }>
                    <Badge variant={statusVariant(detail.status, outcome.tone)} size='sm'>
                      {statusBadgeLabel(detail.status, outcome.tone)}
                    </Badge>
                  </Tooltip>
                </>
              )}
            </div>
          }
          actions={
            headerActions && (
              // Icon-only, the shape `payout-evidence-drawer.tsx` uses: a drawer
              // header is a narrow strip and a worded button crowds the doc
              // number out of it at 380px.
              <div className='flex items-center gap-1'>
                {entryUrl && (
                  <Tooltip content={`View in ${providerLabel}`}>
                    <Button variant='ghost' size='icon-xs' asChild>
                      {/* ⚠️ `aria-label` as well as the tooltip - Radix associates a
                          tooltip with `aria-describedby` only while it is open, so
                          an icon-only link has no accessible NAME without it. */}
                      <a
                        aria-label={`View in ${providerLabel}`}
                        href={entryUrl}
                        target='_blank'
                        rel='noreferrer'>
                        <ExternalLink />
                      </a>
                    </Button>
                  </Tooltip>
                )}
                {/* 🛑 NOT nested under `entryUrl`. The deep link is withheld when
                    the entry went to a company this workspace is no longer
                    connected to; their copy still exists and is still ours to
                    withdraw. */}
                {canUnsync && detail?.exportStatus === 'exported' && (
                  <Tooltip content={`Un-sync from ${providerLabel}`}>
                    <Button
                      variant='ghost'
                      size='icon-xs'
                      aria-label={`Un-sync from ${providerLabel}`}
                      disabled={unsyncExports.isPending}
                      onClick={() => void handleUnsync()}>
                      <CloudOff />
                    </Button>
                  </Tooltip>
                )}
                {detail?.status === 'posted' && (
                  <Tooltip content='Reverse this posting'>
                    <Button
                      variant='ghost'
                      size='icon-xs'
                      aria-label='Reverse this posting'
                      disabled={isReversing}
                      onClick={() => void handleHeaderReverse()}>
                      <Undo2 />
                    </Button>
                  </Tooltip>
                )}
              </div>
            )
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
            {/* 🛑 No padding and no gap on this wrapper, deliberately. `Section`
                draws its own `p-3 pb-4` AND a full-width `border-b`, so stacking
                sections FLUSH is what makes that border read as the divider
                between them - the same shape the record drawer's blocks have.
                A padded, gapped wrapper detaches every divider from the drawer
                edge and floats the blocks, which is what this used to do; the
                journal entry drawer had even grown a `-mx-3` bleed to claw one
                Section back out to the edge. Put padding on a non-Section child
                instead, never here. */}
            <div className='flex flex-col'>
              {/* The metrics strip `payout-evidence-drawer.tsx` opens with, not a
                  `Details` section: two facts and a link do not earn a heading,
                  and a partial row leaves a divider-coloured gap, so `Reverses`
                  spans the pair rather than sitting alone. */}
              <MetricGrid columns={2}>
                <MetricCell
                  label='Period'
                  icon={<CalendarClock className='size-4 text-muted-foreground' />}
                  value={formatPeriodLabel(detail.periodKey)}
                />
                <MetricCell
                  label='Posted'
                  icon={<Clock className='size-4 text-muted-foreground' />}
                  value={
                    detail.postedAt
                      ? formatAuditTimestamp(detail.postedAt, bookTimeZone)
                      : 'Not in the books yet'
                  }
                />
                {isReversal && (
                  <MetricCell label='Reverses' className='col-span-2'>
                    <Button
                      variant='link'
                      size='sm'
                      className='h-auto p-0'
                      onClick={() => detail.reversesId && onSelectPosting(detail.reversesId)}>
                      <span className='font-mono text-xs'>{detail.reversesId}</span>
                    </Button>
                  </MetricCell>
                )}
              </MetricGrid>

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

              {/* The links (TARGET §1): what this entry is OF (`subject`), and
                  what it names as `parent`, `counterparty` or `member` - read
                  off the stored envelope, the same rows `GlPostingSource`
                  holds. Replaces the register (accounting migration step 1b,
                  part E): a summary is a grouping of postings now, never its
                  own kind of row, so there is no second ledger to drill into. */}
              {sources.length > 0 && (
                <Section
                  title='Links'
                  icon={<Link2 className='size-4' />}
                  description='Every record this entry is linked to, and how.'
                  collapsible={false}>
                  <ul className='flex flex-col gap-1.5 text-sm'>
                    {sources.map((source, index) => (
                      <li
                        key={`${source.sourceKind}-${source.sourceId}-${index}`}
                        className='flex items-center justify-between gap-2'>
                        <span className='truncate font-mono text-xs text-muted-foreground'>
                          {source.sourceKind}:{source.sourceId}
                        </span>
                        <Badge variant='outline' size='xs'>
                          {source.linkRole}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {reasons.length > 0 && (
                <Section
                  title='Why these accounts'
                  icon={<CircleHelp className='size-4' />}
                  description='Which branch chose each account, recorded when the entry posted. Lines a plain role resolved are not listed.'
                  collapsible={false}>
                  <ul className='flex flex-col gap-1.5 text-sm'>
                    {reasons.map((reason, index) => {
                      const line = detail.lines.find((row) => row.lineNumber === reason.line)
                      const account = line
                        ? [line.accountCode, line.accountName].filter(Boolean).join(' ')
                        : `Line ${reason.line}`
                      return (
                        <li key={`${reason.line}-${index}`} className='flex flex-col'>
                          <span className='font-mono text-xs text-muted-foreground'>{account}</span>
                          <span>
                            {isReversal ? 'Reversing: ' : ''}
                            {reason.sentence}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </Section>
              )}

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

              <Section
                title='Reverse this posting'
                icon={<Undo2 className='size-4' />}
                description='A mistake is corrected by reversing and re-entering, never by editing a posted entry.'
                initialOpen={false}>
                <div className='flex flex-col gap-2'>
                  <Label htmlFor='reversal-memo'>Why is it being reversed? (optional)</Label>
                  <Textarea
                    id='reversal-memo'
                    value={memo}
                    onChange={(event) => setMemo(event.target.value)}
                    placeholder='Carried onto the reversing entry, and the only explanation a reader gets later. Left empty, the reversal stands on its own.'
                    rows={3}
                  />
                  <div>
                    <Button
                      variant='outline'
                      size='sm'
                      disabled={detail.status !== 'posted'}
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
        <ConfirmDialog />
      </div>
    </DockableDrawer>
  )
}

/** Red the moment the export refused - the badge is the only place that says so. */
function statusVariant(status: PostingDetail['status'], tone: OutcomeCopy['tone']) {
  if (tone === 'failure') return 'red'
  return status === 'posted' ? 'green' : 'outline'
}

/**
 * 🛑 TWO axes, one badge, so the label has to carry both. `status` is the
 * LEDGER's (`Posted`, `Reversed`) and `tone` is the EXPORT's, and reading only
 * the first put the word "Posted" on a red badge whose tooltip said the export
 * was refused. The entry really is posted - that half was never wrong - so the
 * export word is appended rather than swapped in.
 *
 * `Refused` is the sync queue's word for this state (`SYNC_QUEUE_TAB_LABELS`),
 * not a second vocabulary. A `neutral` tone is a success with an explanation -
 * nothing connected, export switched off - and adds nothing here.
 */
function statusBadgeLabel(status: PostingDetail['status'], tone: OutcomeCopy['tone']): string {
  const label = STATUS_LABEL[status]
  return tone === 'failure' ? `${label} · Refused` : label
}

const STATUS_LABEL: Record<PostingDetail['status'], string> = {
  draft: 'Draft',
  posted: 'Posted',
  reversed: 'Reversed',
}

/**
 * What happened at the provider, reconstructed from the STORED row.
 *
 * ⚠️ A stored `GlPosting` records the outcome, not which of the success paths
 * produced it: `posted`, `already_posted` and `healed` all leave the same row
 * behind, so this reports `posted` for all three. It never invents a failure -
 * `failureReason` is rendered verbatim when the row actually failed - and it
 * keeps `not_connected`, `disabled` and `not_exported` apart, which is the
 * distinction decision `P1` cares about: a missing integration, a setting
 * somebody can flip, and a posting type that is never exported at all have
 * three different remedies, and merging them makes the remedy unguessable.
 *
 * 🛑 `not_exported` is checked FIRST of all, because a `'none'`-routed
 * row is indistinguishable from a disconnected org by `providerId` alone: both
 * store `'none'`. Only the posting type separates them, which is why this reads
 * the route table rather than guessing from the row (brief 22 §5).
 *
 * 🛑 Reads `exportStatus`, NOT `status`. It used to branch on
 * `status === 'failed'`, which is now unreachable - `status` says what the
 * LEDGER did and a provider can no longer move it. Left as it was, this panel
 * would report every refused export as a clean `posted`
 * (plans/accounting/export-state-split.md).
 */
function providerResultFromDetail(detail: {
  exportStatus: string
  docNumber: string | null
  postingType: string
  providerId: string | null
  providerEntryId: string | null
  providerTenantId: string | null
  failureReason: string | null
}): PostResult {
  const providerId = detail.providerId ?? undefined
  // A draft has no doc number yet - `PostResult.docNumber` is optional for
  // exactly this reason.
  const base = { docNumber: detail.docNumber ?? undefined, providerId }

  if (detail.exportStatus === 'failed') {
    return { ...base, status: 'error', error: detail.failureReason ?? undefined }
  }
  // Before the `providerEntryId` check: on a `'none'`-routed type that id is
  // THEIRS, stamped on the way in, not proof we exported anything.
  if (EXPORT_ROUTE_BY_POSTING_TYPE[detail.postingType as PostingType] === 'none') {
    return { ...base, status: 'not_exported' }
  }
  if (detail.providerEntryId) {
    // The tenant travels WITH the id, always. An id handed on without the
    // company it belongs to is what the callout cannot tell apart from an id
    // belonging to the company that happens to be open.
    return {
      ...base,
      status: 'posted',
      providerEntryId: detail.providerEntryId,
      providerTenantId: detail.providerTenantId ?? undefined,
    }
  }
  if (detail.exportStatus === 'not_required' && (!providerId || providerId === 'none')) {
    return { ...base, status: 'not_connected' }
  }
  if (!providerId || providerId === 'none') {
    return { ...base, status: 'not_connected' }
  }
  return { ...base, status: 'disabled' }
}
