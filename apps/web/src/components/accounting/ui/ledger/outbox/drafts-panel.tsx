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
import { Button } from '@auxx/ui/components/button'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { Check, FileClock, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
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
}

/**
 * The month's drafts, with Approve (`postDraft`) and Discard
 * (`discardDraft`) per row, plus a bulk Approve all over what is visible.
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
}: DraftsPanelProps) {
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()
  const draftsQuery = api.ledger.listDrafts.useQuery({})
  const rows = draftsQuery.data ?? []
  const loading = draftsQuery.isPending

  /** The last `postDraft` outcome per row, BY POSTING. Cleared on discard. */
  const [results, setResults] = useState<Record<string, PostResult>>({})
  const [approvingAll, setApprovingAll] = useState(false)
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
  async function approveAll() {
    setApprovingAll(true)
    const nextResults: Record<string, PostResult> = {}
    for (const posting of rows) {
      try {
        nextResults[posting.id] = await postDraft.mutateAsync({ glPostingId: posting.id })
      } catch {
        // A thrown `AuxxError` here is upstream of the poster (a malformed
        // lock setting, a network failure) - `postDraft` itself never throws
        // for a business refusal, so there is nothing named to put on a card.
      }
    }
    setResults((prev) => ({ ...prev, ...nextResults }))
    setApprovingAll(false)
    refresh()
  }

  async function requestDiscard(posting: PostingSummary) {
    const confirmed = await confirm({
      title: `Discard ${posting.docNumber || 'this draft'}?`,
      description:
        'A draft holds no claim and no document number, so nothing else is affected. This cannot be undone from here.',
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
    <div className='flex flex-1 flex-col gap-3 p-3'>
      {rows.length > 1 && (
        <div className='flex justify-end'>
          <Button
            variant='outline'
            size='sm'
            disabled={approvingAll || postDraft.isPending}
            loading={approvingAll}
            loadingText='Approving...'
            onClick={() => void approveAll()}>
            <Check />
            Approve all
          </Button>
        </div>
      )}

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
                  icon={<FileClock className='size-4 text-muted-foreground' />}
                  title={
                    <span className='truncate text-sm'>
                      {posting.memo || humanizePostingType(posting.postingType)}
                    </span>
                  }
                  secondary={
                    <span className='flex items-center gap-1.5 text-muted-foreground text-xs'>
                      <span className='shrink-0'>{humanizePostingType(posting.postingType)}</span>
                      <span className='shrink-0'>
                        {formatAccountingDate(posting.txnDate, bookTimeZone)}
                      </span>
                      <DraftSubjectLink glPostingId={posting.id} />
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
                        disabled={discarding || busy}
                        onClick={() => void requestDiscard(posting)}>
                        <Trash2 />
                      </TreeRowButton>
                      <TreeRowButton
                        persistent
                        tooltipText='Approve and post'
                        disabled={busy || discarding || approvingAll}
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

      <ConfirmDialog />
    </div>
  )
}

/** One row's subject link - the record this draft is FOR, per `GlPostingSource`. */
function DraftSubjectLink({ glPostingId }: { glPostingId: string }) {
  const sourcesQuery = api.ledger.postingSources.useQuery({ glPostingId })
  const subject = (sourcesQuery.data ?? []).find((source) => source.linkRole === 'subject')
  if (!subject) return null
  return <LedgerSourceLink sourceKind={subject.sourceKind} sourceId={subject.sourceId} />
}
