// apps/web/src/components/accounting/ui/ledger/posting-frame.tsx

'use client'

import {
  canReverseExportedPosting,
  type ExportBatchState,
  type ExportBatchTab,
} from '@auxx/lib/accounting/export/client'
import { avenueOfPostingType, type PostingDetail } from '@auxx/lib/accounting/ledger/client'
import { PermissionKey } from '@auxx/lib/permissions/client'
import type { RecordId } from '@auxx/lib/resources/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Label } from '@auxx/ui/components/label'
import { MetricCell, MetricGrid } from '@auxx/ui/components/metric-grid'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import {
  BookOpenCheck,
  CalendarClock,
  CircleHelp,
  Clock,
  ExternalLink,
  Layers,
  Link2,
  Send,
  Undo2,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { toFrame, useOpenRecord } from '~/components/records/record-drill-panels'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { useConfirm } from '~/hooks/use-confirm'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { MovementBadge } from '../movement-badge'
import { EntryJournal, journalLinesFromDetail } from './entry-journal'
import { EntryRollForward } from './entry-roll-forward'
import { formatAuditTimestamp, formatPeriodLabel } from './format'
import { LedgerSourceLink } from './ledger-source-link'
import { ExportBatchStateBadge } from './outbox/export-batch-badge'
import { ExportFailureRemedy } from './outbox/export-failure-remedy'
import { readStoredAssertions, readStoredReasons } from './stored-draft'

/** What `LedgerDrawerHost` puts in its one `DrawerHeader` while a posting is on top. */
export interface FrameHeader {
  /** `DockableDrawer`'s plain-text title. */
  drawerTitle: string
  icon: ReactNode
  title: ReactNode
  actions: ReactNode
  /** Rendered by the host — the confirm an action here opens. */
  overlay?: ReactNode
}

/**
 * The posting frame's identity strip, read by the host rather than the frame:
 * one `DrawerHeader` serves the whole stack (83 §2.4).
 */
export function usePostingFrameHeader(
  postingId: string | null,
  { onReverse, isReversing }: { onReverse: (memo: string) => void; isReversing: boolean }
): FrameHeader {
  const [confirm, ConfirmDialog] = useConfirm()
  const { data: detail } = api.ledger.get.useQuery(
    { id: postingId ?? '' },
    { enabled: !!postingId, staleTime: 30_000 }
  )
  const { can } = useAccess()
  const canRelease = can(PermissionKey.ledgerPost)
  const utils = api.useUtils()
  const { data: batches } = api.ledger.exportBatches.list.useQuery(
    { glPostingIds: [postingId ?? ''] },
    { enabled: !!postingId }
  )
  const exportBatch = batches?.items[0] ?? null
  const canReverse = !!detail && isReversible(detail, exportBatch)

  function refresh() {
    void utils.ledger.exportBatches.list.invalidate()
    void utils.ledger.exportBatches.summaryRows.invalidate()
    void utils.ledger.listExportPostings.invalidate()
    void utils.ledger.outboxCounts.invalidate()
  }
  const send = api.ledger.exportBatches.send.useMutation({
    onSuccess: refresh,
    onError: (error) => toastError({ title: 'Could not send', description: error.message }),
  })

  async function handleHeaderReverse() {
    const confirmed = await confirm({
      title: 'Reverse this posting?',
      description:
        'A reversing entry is posted for the same amounts the other way round. Nothing here is edited or deleted, and you can add a memo from the Reverse section below instead.',
      confirmText: 'Reverse',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) onReverse('')
  }

  return {
    drawerTitle: detail ? `Posting ${detail.docNumber}` : 'Posting',
    icon: <BookOpenCheck className='size-5 text-muted-foreground' />,
    title: (
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
    ),
    actions: (
      // Icon-only, the shape `payout-evidence-drawer.tsx` uses: a drawer
      // header is a narrow strip and a worded button crowds the doc
      // number out of it at 380px.
      <>
        {exportBatch?.state === 'ready' && canRelease && (
          <Tooltip content='Send now'>
            <Button
              variant='ghost'
              size='icon-xs'
              aria-label='Send now'
              disabled={send.isPending}
              onClick={() => send.mutate({ batchId: exportBatch.id })}>
              <Send className={send.isPending ? 'animate-pulse' : undefined} />
            </Button>
          </Tooltip>
        )}
        {canReverse && (
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
      </>
    ),
    overlay: <ConfirmDialog />,
  }
}

interface PostingFrameProps {
  /** From `?posting=<id>` or a `~posting:` peek frame. */
  postingId: string
  currencyCode: string
  bookTimeZone: string
  providerLabel: string
  /** Close the drawer and open the outbox on the batch's own tab. Omit when already there. */
  onOpenOutbox?: (tab: ExportBatchTab) => void
  /** Reverse this posting with a memo. Owned by the caller's actions hook. */
  onReverse: (memo: string) => void
  isReversing: boolean
}

/**
 * One posting, read in a single `ledger.get` call — the body of a `~posting:`
 * frame in `LedgerDrawerHost`, which owns the drawer, the header and the stack.
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
 * time, and the roll-forward comes from the stored envelope's assertions - already
 * swapped by `reverseEntry` when this posting is a reversal, so nothing swaps
 * them again here. Re-deriving either would give a different answer the moment
 * the subledger moves, and the number that matters is the one that was posted.
 */
export function PostingFrame({
  postingId,
  currencyCode,
  bookTimeZone,
  providerLabel,
  onOpenOutbox,
  onReverse,
  isReversing,
}: PostingFrameProps) {
  const [memo, setMemo] = useState('')
  const openFrame = useOpenRecord()

  const postingQuery = api.ledger.get.useQuery({ id: postingId }, { staleTime: 30_000 })
  const detail = postingQuery.data

  // The Links section's read: the posting's actual `GlPostingSource` rows.
  const postingSourcesQuery = api.ledger.postingSources.useQuery(
    { glPostingId: postingId },
    { staleTime: 30_000 }
  )

  // The Export section's read (step 3 part C): the batch this posting is a live
  // member of. A `withdrawn` batch's `ExportBatchPosting` rows are excluded
  // server-side (`isNull(withdrawnAt)`), so a match always belongs to a batch
  // still on one of the queue's tabs.
  const exportBatchesQuery = api.ledger.exportBatches.list.useQuery({ glPostingIds: [postingId] })
  const exportBatch = exportBatchesQuery.data?.items[0] ?? null
  const canReverse = !!detail && isReversible(detail, exportBatch)

  const utils = api.useUtils()
  /** The same queries `usePostingFrameHeader`'s own refresh invalidates. */
  function refreshExport() {
    void utils.ledger.exportBatches.list.invalidate()
    void utils.ledger.exportBatches.summaryRows.invalidate()
    void utils.ledger.listExportPostings.invalidate()
    void utils.ledger.outboxCounts.invalidate()
  }

  const assertions = detail ? readStoredAssertions(detail.draft) : null
  const reasons = detail ? readStoredReasons(detail.draft) : []
  const sources = postingSourcesQuery.data ?? []
  const isReversal = !!detail?.reversesId

  function handleReverse() {
    onReverse(memo)
    setMemo('')
  }

  if (postingQuery.isPending) {
    return (
      <div className='flex flex-col gap-2 p-4'>
        <Skeleton className='h-20 w-full' />
        <Skeleton className='h-40 w-full' />
      </div>
    )
  }

  if (!detail) {
    return (
      <div className='p-4 text-sm text-muted-foreground'>
        No posting matches this link. It may have been reversed and re-entered under a new revision.
      </div>
    )
  }

  return (
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
                onClick={() =>
                  detail.reversesId && openFrame?.(toFrame('posting', detail.reversesId))
                }>
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
          <EntryJournal lines={journalLinesFromDetail(detail.lines)} currencyCode={currencyCode} />
        </Section>

        {/* The export (TARGET §3, §4 gate 2, step 3 part C): the batch
            this posting sits in, if a live one has claimed it - `null`
            reads as "not built yet", not as a fault, so an unbuilt
            posted entry gets no section rather than an empty one.
            🛑 Retry is HERE (89 D5): it is one row's refusal asked
            for again in the same breath, and somebody who has just mapped
            an account below should not be walked to another screen to
            press it. Un-sync stays on the queue - it deletes the
            provider's copy, over potentially many postings at once. */}
        {exportBatch && (
          <Section
            title='Export'
            icon={<Send className='size-4' />}
            description={`Where this entry stands with ${providerLabel}.`}
            collapsible={false}
            actions={
              onOpenOutbox && (
                <Button
                  variant='ghost'
                  size='xs'
                  onClick={() => onOpenOutbox(exportBatch.state as ExportBatchTab)}>
                  <ExternalLink />
                  Open outbox
                </Button>
              )
            }>
            <div className='flex flex-col gap-2'>
              <div className='flex items-center gap-2'>
                <ExportBatchStateBadge
                  state={exportBatch.state}
                  failureClass={exportBatch.failureClass}
                  size='sm'
                />
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
              {exportBatch.state === 'failed' && (
                <ExportFailureRemedy
                  batchId={exportBatch.id}
                  state='failed'
                  failureClass={exportBatch.failureClass}
                  items={exportBatch.failureItems}
                  blockers={exportBatch.blockers}
                  lastError={exportBatch.lastError}
                  nextAttemptAt={exportBatch.nextAttemptAt}
                  onChanged={refreshExport}
                />
              )}
              {/* The pickers sit ABOVE Send now (in the header) because the
                  mapping table already refuses this send (89 D7). */}
              {exportBatch.state === 'ready' && exportBatch.blockers.length > 0 && (
                <ExportFailureRemedy
                  batchId={exportBatch.id}
                  state='ready'
                  failureClass='configuration'
                  items={exportBatch.blockers}
                  lastError={null}
                  onChanged={refreshExport}
                />
              )}
            </div>
          </Section>
        )}

        {/* The links (TARGET §1): what this entry is OF (`subject`), and
            what it names as `parent`, `counterparty` or `member` -
            `ledger.postingSources`' `GlPostingSource` rows. Replaces the register (accounting
            migration step 1b, part E): a summary is a grouping of
            postings now, never its own kind of row, so there is no
            second ledger to drill into. */}
        {sources.length > 0 && (
          <Section
            title='Links'
            icon={<Link2 className='size-4' />}
            description='Every record this entry is linked to, and how.'
            collapsible={false}>
            <TreeRowList
              items={sources}
              visibleLimit={5}
              getKey={(source, index) => `${source.sourceKind}-${source.sourceId}-${index}`}
              renderRow={(source) => {
                const recordId = source.recordId as RecordId | null
                const movement = source.movement
                return (
                  <TreeRow
                    title={
                      recordId ? (
                        <RecordBadge
                          recordId={recordId}
                          size='sm'
                          showResourceLabel={source.sourceKind === 'stock_movement'}
                          link
                          openInStack
                        />
                      ) : movement ? (
                        <MovementBadge
                          movement={movement}
                          size='sm'
                          onOpen={
                            openFrame
                              ? () => openFrame(toFrame('movement', movement.id))
                              : undefined
                          }
                        />
                      ) : (
                        <LedgerSourceLink
                          sourceKind={source.sourceKind}
                          sourceId={source.sourceId}
                        />
                      )
                    }
                    trailing={
                      <Badge variant='outline' size='xs'>
                        {source.linkRole}
                      </Badge>
                    }
                  />
                )
              }}
            />
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

        {canReverse && (
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
                  loading={isReversing}
                  loadingText='Reversing...'
                  onClick={handleReverse}>
                  <Undo2 />
                  Reverse
                </Button>
              </div>
            </div>
          </Section>
        )}
      </div>
    </ScrollArea>
  )
}

/** Red the moment the export refused - the badge is the only place that says so. */
/** Posted, and either sent or never exported; a reversal of an entry still in Ready would leave alone. */
function isReversible(detail: PostingDetail, exportBatch: { state: ExportBatchState } | null) {
  return (
    detail.status === 'posted' &&
    canReverseExportedPosting({
      avenue: avenueOfPostingType(detail.postingType),
      exportState: exportBatch?.state ?? null,
    })
  )
}

function statusVariant(status: PostingDetail['status']) {
  return status === 'posted' ? 'green' : 'outline'
}

const STATUS_LABEL: Record<PostingDetail['status'], string> = {
  posted: 'Posted',
  reversed: 'Reversed',
}
