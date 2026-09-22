// apps/web/src/components/accounting/ui/ledger/outbox/drafts-panel.tsx

'use client'

// Accounting > Ledger > Outbox > the DRAFTS tab (accounting migration step 1c,
// TARGET §4 gate 1). Every avenue whose `accounting.autoPost.<avenue>` is off
// leaves a draft `GlPosting` here instead of posting straight through.
//
// 🛑 EVERY period, like the tabs beside it - `ledger.listDrafts` takes no
// `periodKey` and narrows to `status = 'draft'` in SQL.

import type { PostingSummary } from '@auxx/lib/accounting/journals/client'
import type { PostResult } from '@auxx/lib/accounting/ledger/client'
import { ActionBar } from '@auxx/ui/components/action-bar'
import { TreeRowButton } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { Check, FileClock, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { InfiniteListTail } from '~/components/global/infinite-list-tail'
import { useBulkMode, useListSelection, useSelectionIds } from '~/components/list-selection'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { MovementBadge } from '../../movement-badge'
import { EntryBlockers } from '../entry-blockers'
import { formatAccountingDate, formatMinor } from '../format'
import { LedgerSourceLink } from '../ledger-source-link'
import { PostResultOverlay } from '../post-result-callout'
import { postingTypeLabel } from '../type-labels'
import { OutboxRow } from './outbox-row'
import { type OutboxFilters, outboxCategoryInput } from './outbox-toolbar'

interface DraftsPanelProps {
  filters: OutboxFilters
  emptyAction?: React.ReactNode
  emptyTitle?: string

  /** Owned by `outbox-panel.tsx` so every tab's empty copy is written in one place. */
  emptyDescription: string
  currencyCode: string
  bookTimeZone: string
  /** The draft open in the ledger's `?posting=` drawer, so its row reads as the one you are looking at. */
  activePostingId: string | null
  onSelectPosting: (glPostingId: string) => void
}

/**
 * Every draft, paged, with Approve (`postDraft`) and Discard (`discardDraft`)
 * per row and over a selection.
 *
 * 🛑 A refusal from `postDraft` is a card, never a toast (ground rule 9,
 * matching `post-result-callout.tsx`'s own doc). This panel does not decide
 * which `PostResultStatus` values are failures, `OUTCOMES` does.
 */
export function DraftsPanel({
  filters,
  emptyAction,
  emptyTitle,
  emptyDescription,
  currencyCode,
  bookTimeZone,
  activePostingId,
  onSelectPosting,
}: DraftsPanelProps) {
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()
  const list = api.ledger.listDrafts.useInfiniteQuery(
    {
      search: filters.search || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
      categories: outboxCategoryInput(filters).drafts,
    },
    { getNextPageParam: (page) => page.nextCursor }
  )
  const rows = useMemo(() => list.data?.pages.flatMap((page) => page.items) ?? [], [list.data])

  const selectedIds = useSelectionIds()
  const selecting = useBulkMode()
  const setItemIds = useListSelection((state) => state.setItemIds)
  const exitSelection = useListSelection((state) => state.exit)
  useEffect(() => {
    setItemIds(rows.map((posting) => posting.id))
  }, [rows, setItemIds])

  /** The last `postDraft` outcome per row, BY POSTING. Cleared on discard. */
  const [results, setResults] = useState<Record<string, PostResult>>({})
  const [approvingMany, setApprovingMany] = useState(false)
  const [discardingMany, setDiscardingMany] = useState(false)
  /** The server's own refusal sentence for the last discard - a card, never a toast (ground rule 9). */
  const [discardRefusal, setDiscardRefusal] = useState<string | null>(null)

  function refresh() {
    void utils.ledger.listDrafts.invalidate()
    void utils.ledger.listPostings.invalidate()
    void utils.ledger.periods.invalidate()
    void utils.ledger.outboxCounts.invalidate()
  }

  function dismissResult(glPostingId: string) {
    setResults((prev) => {
      const { [glPostingId]: _dropped, ...rest } = prev
      return rest
    })
  }

  const postDraft = api.ledger.postDraft.useMutation()
  const discardDraft = api.ledger.discardDraft.useMutation()

  function approveOne(glPostingId: string) {
    postDraft.mutate(
      { glPostingId },
      {
        onSuccess: (result) => {
          setResults((prev) => ({ ...prev, [glPostingId]: result }))
          refresh()
        },
      }
    )
  }

  /**
   * Sequential, not `Promise.all` - one `postDraft` claims the period at a
   * time, and forty at once would race the same claim/lock checks. A row's
   * refusal lands on its own `PostResultCallout`; a transport-level throw is
   * upstream of the poster and has no card, so it is left to the row.
   */
  async function approveMany(glPostingIds: string[]) {
    setApprovingMany(true)
    const nextResults: Record<string, PostResult> = {}
    for (const glPostingId of glPostingIds) {
      try {
        nextResults[glPostingId] = await postDraft.mutateAsync({ glPostingId })
      } catch {
        // Nothing named to put on a card - see above.
      }
    }
    setResults((prev) => ({ ...prev, ...nextResults }))
    setApprovingMany(false)
    exitSelection()
    refresh()
  }

  /** Sequential like {@link approveMany}; every refusal lands on the one `EntryBlockers` card. */
  async function discardMany(glPostingIds: string[]) {
    const confirmed = await confirm({
      title: `Discard ${glPostingIds.length} drafts?`,
      description:
        'A draft holds no claim and no document number, so nothing else is affected. This cannot be undone from here.',
      confirmText: 'Discard the drafts',
      cancelText: 'Keep them',
      destructive: true,
    })
    if (!confirmed) return
    setDiscardRefusal(null)
    setDiscardingMany(true)
    const refusals: string[] = []
    for (const glPostingId of glPostingIds) {
      try {
        await discardDraft.mutateAsync({ glPostingId })
        setResults((prev) => {
          const { [glPostingId]: _dropped, ...rest } = prev
          return rest
        })
      } catch (error) {
        refusals.push(error instanceof Error ? error.message : 'The draft was not discarded.')
      }
    }
    setDiscardingMany(false)
    if (refusals.length > 0) setDiscardRefusal(refusals.join(' '))
    exitSelection()
    refresh()
  }

  async function requestDiscard(posting: PostingSummary) {
    const confirmed = await confirm({
      title: `Discard ${posting.docNumber || 'this draft'}?`,
      description:
        'A draft holds no claim and no document number, so nothing else is affected. This cannot be undone from here.' +
        // The bill is already `posted`, so Post will not take it again - Save is
        // the door back.
        (posting.postingType === 'vendor_bill'
          ? ' For a vendor bill, Edit then Save drafts it again.'
          : ''),
      confirmText: 'Discard the draft',
      cancelText: 'Keep it',
      destructive: true,
    })
    if (!confirmed) return
    setDiscardRefusal(null)
    discardDraft.mutate(
      { glPostingId: posting.id },
      {
        onSuccess: () => {
          dismissResult(posting.id)
          refresh()
        },
        onError: (error) => setDiscardRefusal(error.message),
      }
    )
  }

  return (
    <div className={`flex flex-1 flex-col gap-3 p-3 ${rows.length > 0 ? 'pb-16' : ''}`}>
      {discardRefusal && (
        <EntryBlockers blockers={[{ status: 'discard_refused', error: discardRefusal }]} />
      )}

      {!list.isPending && rows.length === 0 ? (
        <EmptyState
          className='py-8'
          icon={FileClock}
          title={emptyTitle ?? 'Nothing is waiting for approval'}
          description={emptyDescription}
          button={emptyAction}
        />
      ) : (
        <>
          <TreeRowList
            items={rows}
            loading={list.isPending}
            skeletonCount={2}
            className='gap-px'
            getKey={(posting) => posting.id}
            renderRow={(posting) => {
              const result = results[posting.id]
              const busy = postDraft.isPending && postDraft.variables?.glPostingId === posting.id
              const discarding =
                discardDraft.isPending && discardDraft.variables?.glPostingId === posting.id
              return (
                <div className='relative'>
                  <OutboxRow
                    id={posting.id}
                    icon={<FileClock className='size-4 text-muted-foreground' />}
                    date={formatAccountingDate(posting.txnDate, bookTimeZone)}
                    typeLabel={postingTypeLabel(posting.postingType)}
                    // A draft holds no document number yet, so the memo is its
                    // only identity - and it no longer restates the badge.
                    title={posting.docNumber || posting.memo || ''}
                    secondary={
                      <span className='flex items-center gap-1.5 text-muted-foreground text-xs'>
                        <DraftLinks glPostingId={posting.id} />
                      </span>
                    }
                    amount={formatMinor(posting.totalMinor, currencyCode)}
                    actions={
                      <>
                        <TreeRowButton
                          persistent
                          variant='destructive'
                          tooltipText='Discard this draft'
                          disabled={discarding || busy || discardingMany}
                          onClick={() => void requestDiscard(posting)}>
                          <Trash2 />
                        </TreeRowButton>
                        <TreeRowButton
                          persistent
                          tooltipText='Approve and post'
                          disabled={busy || discarding || approvingMany}
                          onClick={() => approveOne(posting.id)}>
                          <Check className={busy ? 'animate-pulse' : undefined} />
                        </TreeRowButton>
                      </>
                    }
                    onOpen={() => onSelectPosting(posting.id)}
                    active={activePostingId === posting.id}
                    selectLabel={`Select draft ${posting.memo || posting.id}`}
                  />
                  {result && (
                    <PostResultOverlay
                      result={result}
                      onDismiss={() => dismissResult(posting.id)}
                    />
                  )}
                </div>
              )
            }}
          />
          <InfiniteListTail
            hasNextPage={list.hasNextPage}
            isFetchingNextPage={list.isFetchingNextPage}
            fetchNextPage={list.fetchNextPage}
            loadingLabel='Loading more drafts...'
          />
        </>
      )}

      <ActionBar
        open={selecting}
        onOpenChange={(open) => !open && exitSelection()}
        duration={Number.POSITIVE_INFINITY}
        position='bottom-center'
        selectedCount={selectedIds.length}
        selectedLabel='selected'
        showClose
        actions={[
          {
            id: 'approve',
            label: 'Approve and post',
            icon: Check,
            disabled: approvingMany || discardingMany || postDraft.isPending,
            onClick: () => void approveMany(selectedIds),
          },
          {
            id: 'discard',
            label: 'Discard',
            icon: Trash2,
            variant: 'destructive' as const,
            disabled: approvingMany || discardingMany || discardDraft.isPending,
            onClick: () => void discardMany(selectedIds),
          },
        ]}
      />
      <ConfirmDialog />
    </div>
  )
}

/**
 * The records a draft is about, as badges: its `pending` subject (the claim
 * `postDraft` will take), and its `parent` and `counterparty` links.
 */
function DraftLinks({ glPostingId }: { glPostingId: string }) {
  const sourcesQuery = api.ledger.postingSources.useQuery({ glPostingId })
  const sources = sourcesQuery.data ?? []
  if (sources.length === 0) return null
  return (
    // One badge row tall with `overflow-hidden`, so a badge that does not fit
    // wraps onto a hidden second line and disappears whole rather than clipped.
    // `box-content p-px` keeps the 1px ring inside the clip box.
    <span className='box-content flex h-4 min-w-0 flex-wrap items-center gap-1 overflow-hidden p-px'>
      {sources.map((source) =>
        source.recordId ? (
          <RecordBadge
            key={source.id}
            recordId={source.recordId}
            size='sm'
            showResourceLabel={source.sourceKind === 'stock_movement'}
          />
        ) : source.movement ? (
          <MovementBadge key={source.id} movement={source.movement} size='sm' detail='compact' />
        ) : (
          <LedgerSourceLink
            key={source.id}
            sourceKind={source.sourceKind}
            sourceId={source.sourceId}
          />
        )
      )}
    </span>
  )
}
