// apps/web/src/components/accounting/ui/ledger/posting-drawer.tsx

'use client'

import type { ExportBatchTab } from '@auxx/lib/accounting/export/client'
import type { PostingDetail } from '@auxx/lib/accounting/ledger/client'
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
import {
  BookOpenCheck,
  CalendarClock,
  CircleHelp,
  Clock,
  ExternalLink,
  Layers,
  Link2,
  PanelRight,
  Send,
  Undo2,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { EntryJournal, journalLinesFromDetail } from './entry-journal'
import { EntryRollForward } from './entry-roll-forward'
import { formatAuditTimestamp, formatPeriodLabel } from './format'
import { LedgerSourceLink } from './ledger-source-link'
import { readStoredAssertions, readStoredReasons, readStoredSources } from './stored-draft'
import { ExportBatchStateBadge } from './sync-queue/export-batch-badge'

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
  /** Close this drawer and open the export queue on the batch's own tab. */
  onOpenExportQueue: (tab: ExportBatchTab) => void
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
  onOpenExportQueue,
  onReverse,
  isReversing,
}: PostingDrawerProps) {
  const [memo, setMemo] = useState('')
  const [confirm, ConfirmDialog] = useConfirm()
  const _utils = api.useUtils()

  const postingQuery = api.ledger.get.useQuery(
    { id: postingId ?? '' },
    { enabled: !!postingId, staleTime: 30_000 }
  )
  const detail = postingQuery.data

  // The Links section's primary read (accounting migration step 1c): the
  // actual `GlPostingSource` rows. A draft written before `postEntry` gained
  // `sources` support (or one built by an older revision) may have none, so
  // the stored envelope below is the fallback for that case only - never the
  // primary source for a posted entry, whose `GlPostingSource` rows are the
  // claim itself and cannot drift from what is rendered here.
  const postingSourcesQuery = api.ledger.postingSources.useQuery(
    { glPostingId: postingId ?? '' },
    { enabled: !!postingId, staleTime: 30_000 }
  )

  // The Export section's read (step 3 part C): every batch, the same
  // unbounded read the queue itself renders (`ledger.exportBatches.list`), so
  // this rides that cache instead of adding a second shape of the same query.
  // A `withdrawn` batch's `ExportBatchPosting` rows are excluded server-side
  // (`isNull(withdrawnAt)`), so a member found here always belongs to a batch
  // still on one of the queue's four tabs.
  const exportBatchesQuery = api.ledger.exportBatches.list.useQuery({}, { enabled: !!postingId })
  const exportBatch = useMemo(() => {
    if (!postingId) return null
    return (
      (exportBatchesQuery.data ?? []).find((batch) =>
        batch.members.some((member) => member.glPostingId === postingId)
      ) ?? null
    )
  }, [exportBatchesQuery.data, postingId])

  /** Nothing to put in the strip is an absent strip, not an empty flex row. */
  const headerActions = detail?.status === 'posted'

  const assertions = detail ? readStoredAssertions(detail.draft) : null
  const reasons = detail ? readStoredReasons(detail.draft) : []
  const linkedSources = postingSourcesQuery.data ?? []
  const sources =
    linkedSources.length > 0
      ? linkedSources
      : detail?.status === 'draft'
        ? readStoredSources(detail.draft)
        : []
  const isReversal = !!detail?.reversesId

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
              {detail && (
                <>
                  <Badge variant='outline' size='sm'>
                    Revision {detail.revision}
                  </Badge>
                  <Badge variant={statusVariant(detail.status)} size='sm'>
                    {STATUS_LABEL[detail.status]}
                  </Badge>
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

              {/* The export (TARGET §3, §4 gate 2, step 3 part C): the batch
                  this posting sits in, if a live one has claimed it - `null`
                  reads as "not built yet", not as a fault, so an unbuilt
                  posted entry gets no section rather than an empty one.
                  🛑 No Retry and no Un-sync HERE - both actions live on the
                  queue itself, over potentially many postings at once; this
                  is a status and a way there, never a second door to act. */}
              {exportBatch && (
                <Section
                  title='Export'
                  icon={<Send className='size-4' />}
                  description={`Where this entry stands with ${providerLabel}.`}
                  collapsible={false}>
                  <div className='flex flex-col gap-2'>
                    <div className='flex items-center gap-2'>
                      <ExportBatchStateBadge state={exportBatch.state} size='sm' />
                      {exportBatch.providerObjectUrl ? (
                        <a
                          href={exportBatch.providerObjectUrl}
                          target='_blank'
                          rel='noreferrer'
                          className='inline-flex items-center gap-1 text-primary-600 text-xs hover:underline'>
                          {exportBatch.providerObjectId}
                          <ExternalLink className='size-3' />
                        </a>
                      ) : null}
                    </div>
                    {exportBatch.state === 'failed' && exportBatch.lastError && (
                      <p className='text-destructive text-xs'>{exportBatch.lastError}</p>
                    )}
                    <div>
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={() => onOpenExportQueue(exportBatch.state as ExportBatchTab)}>
                        <PanelRight />
                        Open the export queue
                      </Button>
                    </div>
                  </div>
                </Section>
              )}

              {/* The links (TARGET §1): what this entry is OF (`subject`), and
                  what it names as `parent`, `counterparty` or `member` -
                  `ledger.postingSources`' `GlPostingSource` rows, falling back
                  to the stored envelope only for a draft with none written yet
                  (see the query above). Replaces the register (accounting
                  migration step 1b, part E): a summary is a grouping of
                  postings now, never its own kind of row, so there is no
                  second ledger to drill into. */}
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
                        <LedgerSourceLink
                          sourceKind={source.sourceKind}
                          sourceId={source.sourceId}
                        />
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
function statusVariant(status: PostingDetail['status']) {
  return status === 'posted' ? 'green' : 'outline'
}

const STATUS_LABEL: Record<PostingDetail['status'], string> = {
  draft: 'Draft',
  posted: 'Posted',
  reversed: 'Reversed',
}
