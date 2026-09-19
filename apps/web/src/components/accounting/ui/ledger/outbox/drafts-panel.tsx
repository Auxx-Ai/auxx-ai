// apps/web/src/components/accounting/ui/ledger/outbox/drafts-panel.tsx

'use client'

// Accounting > Ledger > Outbox > the DRAFTS tab (accounting migration step 1c,
// TARGET §4 gate 1). Every avenue whose `accounting.autoPost.<avenue>` is off
// leaves a draft `GlPosting` here instead of posting straight through -
// `journal_entry`'s own draft (raised from the Entries section's New journal
// entry) is the one exception, still edited through its own drawer, but it too
// shows up here once created and lands on this list like any other avenue's.
//
// 🛑 EVERY period, like the export tabs beside it. This is a tab in one strip
// now, and a strip whose scope changed per tab made "3 drafts" mean two
// different things on one screen. `ledger.listDrafts` takes no `periodKey`
// from here and narrows to `status = 'draft'` in SQL, before its own cap.

import type { PostingSummary } from '@auxx/lib/accounting/journals/client'
import type { PostResult } from '@auxx/lib/accounting/ledger/client'
import { ActionBar } from '@auxx/ui/components/action-bar'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { cn } from '@auxx/ui/lib/utils'
import { Check, FileClock, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { useBulkMode, useListSelection, useSelectionIds } from '~/components/list-selection'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { EntryBlockers } from '../entry-blockers'
import { formatAccountingDate, formatMinor, humanizePostingType } from '../format'
import { LedgerSourceLink } from '../ledger-source-link'
import { PostResultCallout } from '../post-result-callout'

interface DraftsPanelProps {
  currencyCode: string
  bookTimeZone: string
  providerLabel: string
  connectedTenantId: string | null
  /** The draft open in the ledger's `?posting=` drawer, so its row reads as the one you are looking at. */
  activePostingId: string | null
  onSelectPosting: (glPostingId: string) => void
}

/**
 * The month's drafts, with Approve (`postDraft`) and Discard
 * (`discardDraft`) per row and over a selection. Selection state is the
 * outbox's own `ListSelectionProvider`; the outbox sets the item ids and
 * draws the select-all box, this panel draws the rows and the action bar.
 *
 * 🛑 A refusal from `postDraft` is a card, never a toast (ground rule 9,
 * matching `post-result-callout.tsx`'s own doc). `already_posted`,
 * `not_connected` and every other non-`failure` outcome render the same way -
 * this panel does not decide which `PostResultStatus` values are failures,
 * `OUTCOMES` does.
 */
export function DraftsPanel({
  currencyCode,
  bookTimeZone,
  providerLabel,
  connectedTenantId,
  activePostingId,
  onSelectPosting,
}: DraftsPanelProps) {
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()
  const draftsQuery = api.ledger.listDrafts.useQuery({})
  const rows = draftsQuery.data ?? []
  const loading = draftsQuery.isPending

  const selectedIds = useSelectionIds()
  const selecting = useBulkMode()
  const toggle = useListSelection((state) => state.toggle)
  const exitSelection = useListSelection((state) => state.exit)

  /** The last `postDraft` outcome per row, BY POSTING. Cleared on discard. */
  const [results, setResults] = useState<Record<string, PostResult>>({})
  const [approvingMany, setApprovingMany] = useState(false)
  const [discardingMany, setDiscardingMany] = useState(false)
  /**
   * The server's own refusal sentence for the last discard, or `null` - held
   * in state and rendered through `EntryBlockers`, never a toast (ground rule
   * 9, `use-discard-journal-entry.ts`'s own doc). `discardDraftPosting` throws
   * an `AuxxError` rather than returning a `PostResult` (there is no claim to
   * release, so there is no status to report), so this is a plain `onError`.
   */
  const [discardRefusal, setDiscardRefusal] = useState<string | null>(null)

  function refresh() {
    void utils.ledger.listDrafts.invalidate()
    void utils.ledger.listPostings.invalidate()
    void utils.ledger.periods.invalidate()
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
   * time, and running forty of them at once would have every row racing the
   * same claim/lock checks instead of seeing each other's results.
   *
   * 🛑 A row's own refusal still lands on its own `PostResultCallout` - a
   * transport-level throw is the only case this loop itself has to answer
   * for, and there is no card for "the network failed", so that one stays a
   * toast (ground rule 9 is about refusals the server named, not this).
   */
  async function approveMany(glPostingIds: string[]) {
    setApprovingMany(true)
    const nextResults: Record<string, PostResult> = {}
    for (const glPostingId of glPostingIds) {
      try {
        nextResults[glPostingId] = await postDraft.mutateAsync({ glPostingId })
      } catch {
        // A thrown `AuxxError` here is upstream of the poster (a malformed
        // lock setting, a network failure) - `postDraft` itself never throws
        // for a business refusal, so there is nothing named to put on a card.
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
          setResults((prev) => {
            const { [posting.id]: _dropped, ...rest } = prev
            return rest
          })
          refresh()
        },
        onError: (error) => setDiscardRefusal(error.message),
      }
    )
  }

  return (
    // No count line: the Outbox's own tab badge carries it.
    <div className='flex flex-1 flex-col gap-3 p-3 pb-16'>
      {discardRefusal && (
        <EntryBlockers blockers={[{ status: 'discard_refused', error: discardRefusal }]} />
      )}

      {!loading && rows.length === 0 ? (
        <EmptyState
          icon={FileClock}
          title='Nothing is waiting for approval'
          description='A draft is left here when its avenue posts with autoPost switched off (Settings › Posting).'
        />
      ) : (
        <TreeRowList
          items={rows}
          loading={loading}
          skeletonCount={2}
          getKey={(posting) => posting.id}
          renderRow={(posting) => {
            const result = results[posting.id]
            const busy = postDraft.isPending && postDraft.variables?.glPostingId === posting.id
            const discarding =
              discardDraft.isPending && discardDraft.variables?.glPostingId === posting.id
            return (
              <div className='flex flex-col gap-1.5'>
                <TreeRow
                  className={TREE_SECONDARY_NOTRUNCATE}
                  selectable
                  selecting={selecting}
                  selected={selectedIds.includes(posting.id)}
                  onSelectChange={(_next, event) =>
                    toggle(posting.id, { shiftKey: event.shiftKey })
                  }
                  selectLabel={`Select draft ${posting.memo || posting.id}`}
                  // While picking, a row click extends the selection rather than
                  // opening the drawer - the review queue's rule.
                  onToggleOpen={() =>
                    selecting ? toggle(posting.id) : onSelectPosting(posting.id)
                  }
                  // The review queue's idiom: `info` is what a picked row wears, `primary-*` the row you look at.
                  rowClassName={cn(
                    'bg-primary-100/50 hover:bg-primary-100',
                    activePostingId === posting.id && 'bg-primary-100 ring-1 ring-primary-200',
                    selectedIds.includes(posting.id) &&
                      cn(
                        'bg-info/10 hover:bg-info/15 dark:bg-info/20 dark:hover:bg-info/25',
                        activePostingId === posting.id && 'ring-info/40'
                      )
                  )}
                  icon={<FileClock className='size-4 text-muted-foreground' />}
                  // The review queue's columns: a width-pinned date first, so every
                  // row's label starts at the same x and the eye reads straight down.
                  title={
                    <span className='flex min-w-0 items-center gap-1.5'>
                      <span className='w-24 shrink-0 font-mono text-muted-foreground text-xs tabular-nums'>
                        {formatAccountingDate(posting.txnDate, bookTimeZone)}
                      </span>
                      <span className='truncate text-sm'>
                        {posting.memo || humanizePostingType(posting.postingType)}
                      </span>
                    </span>
                  }
                  secondary={
                    <span className='flex items-center gap-1.5 text-muted-foreground text-xs'>
                      <span className='shrink-0'>{humanizePostingType(posting.postingType)}</span>
                      <DraftLinks glPostingId={posting.id} />
                    </span>
                  }
                  actions={
                    <div className='flex shrink-0 items-center gap-2'>
                      <span className='font-mono text-xs tabular-nums'>
                        {formatMinor(posting.totalMinor, currencyCode)}
                      </span>
                      <TreeRowButton
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
                    </div>
                  }
                />
                {result && (
                  <div className='px-1'>
                    <PostResultCallout
                      result={result}
                      providerLabel={providerLabel}
                      connectedTenantId={connectedTenantId}
                    />
                  </div>
                )}
              </div>
            )
          }}
        />
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
 * The records a draft is about, as badges. A draft holds no subject claim yet
 * (`postDraft` takes it), so its `parent` and `counterparty` links are what
 * identify it - the order it settles and who paid.
 */
function DraftLinks({ glPostingId }: { glPostingId: string }) {
  const sourcesQuery = api.ledger.postingSources.useQuery({ glPostingId })
  const sources = sourcesQuery.data ?? []
  if (sources.length === 0) return null
  return (
    <span className='flex min-w-0 items-center gap-1'>
      {sources.map((source) =>
        source.recordId ? (
          <RecordBadge key={source.id} recordId={source.recordId} size='sm' />
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
