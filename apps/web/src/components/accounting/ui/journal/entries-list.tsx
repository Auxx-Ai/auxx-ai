// apps/web/src/components/accounting/ui/journal/entries-list.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { InputSearch } from '@auxx/ui/components/input-search'
import { ListToolbar, ListToolbarGroup } from '@auxx/ui/components/list-toolbar'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { EmptySection } from '@auxx/ui/components/section'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { cn } from '@auxx/ui/lib/utils'
import { FileText, SearchX, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useDiscardJournalEntry } from '~/components/accounting/hooks/use-discard-journal-entry'
import { type EntryStatus, useMonthEntries } from '~/components/accounting/hooks/use-month-entries'
import { EntryBlockers } from '~/components/accounting/ui/ledger/entry-blockers'
import { formatMinor } from '~/components/accounting/ui/ledger/format'
import { useAccess } from '~/providers/capabilities-provider'

interface EntriesListProps {
  /**
   * The month to list. Omitted when no period resolves at all - an org whose
   * cutoff is still ahead of the wall clock has no closable month, and the
   * drafts a bookkeeper has raised still have to be reachable.
   */
  periodKey?: string
  currencyCode: string
  /** Row click on a posted/reversed entry - opens `PostingDrawer` via `?posting=`. */
  onSelectPosting: (id: string) => void
  /** Row click on a draft - opens the JE drawer via `?je=<id>`. */
  onSelectJournalEntry: (id: string) => void
}

/** The exact dot classes `ledger-toolbar.tsx`'s `STATE_DOT` uses, per ui-plan.md §2.1. */
const STATUS_DOT: Record<EntryStatus, string> = {
  posted: 'bg-green-500',
  reversed: 'bg-primary-400',
  pending: 'bg-amber-500',
  failed: 'bg-destructive',
  draft: 'bg-amber-500',
}

const STATUS_LABEL: Record<EntryStatus, string> = {
  posted: 'Posted',
  reversed: 'Reversed',
  pending: 'In flight',
  failed: 'Failed',
  draft: 'Draft',
}

/**
 * Puts back the horizontal padding `SECTION_BLEED` strips off this list's
 * `Section` - `mx-3` rather than `px-3`, so a row's own hover background and
 * the empty states' borders sit inside the inset rather than painting across it.
 */
const INSET = 'mx-3'

/**
 * Rows shown before the list collapses behind "Show N more".
 *
 * 🛑 A month is not a small list. An org posting fulfillments daily lands
 * around sixty rows here, and every one of them pushed Roll-forward, the close
 * and the agreement check off the bottom of the page - the sections somebody
 * scrolled down to reach. Twelve is roughly a screen: enough to see the shape
 * of the month, short enough that what follows the list is still reachable.
 *
 * ⚠️ The cap is on what RENDERS, never on what is searched. The filter tabs and
 * the search box run over the whole month (`visible`), so a row past the cap is
 * still findable - which is the reason the cap is safe to have at all.
 */
const VISIBLE_LIMIT = 12

/** The filter tabs, in the order somebody narrows a month down. */
const FILTERS = [
  { value: 'all', label: 'All', tooltip: undefined },
  { value: 'posted', label: 'Posted', tooltip: undefined },
  { value: 'draft', label: 'Drafts', tooltip: 'Raised but not posted' },
  { value: 'reversed', label: 'Reversed', tooltip: undefined },
  { value: 'attention', label: 'Attention', tooltip: 'Failed, or still in flight' },
] as const

type EntryFilter = (typeof FILTERS)[number]['value']

/**
 * 🛑 `attention` is failed AND in-flight, not just failed. A posting stuck at
 * `pending` never reached the provider either; splitting them into two tabs of
 * one row each would hide the second behind a tab nobody clicks.
 */
const FILTER_MATCHES: Record<Exclude<EntryFilter, 'all'>, (status: EntryStatus) => boolean> = {
  posted: (status) => status === 'posted',
  draft: (status) => status === 'draft',
  reversed: (status) => status === 'reversed',
  attention: (status) => status === 'failed' || status === 'pending',
}

/**
 * The period's entries, narrowable.
 *
 * The two reads and how they merge live in `useMonthEntries` - the stats strip
 * above this list counts the same rows, and one hook is what keeps the two from
 * disagreeing. This component is the list, its filter tabs and its search.
 */
export function EntriesList({
  periodKey,
  currencyCode,
  onSelectPosting,
  onSelectJournalEntry,
}: EntriesListProps) {
  const { rows, loading } = useMonthEntries(periodKey)
  const { can } = useAccess()
  const discard = useDiscardJournalEntry()

  /**
   * ⚠️ Narrowing is CLIENT-side, over rows already fetched. Both reads return
   * the whole month in one go and a month is bounded - an org posting
   * fulfillments daily tops out around sixty rows - so a server round trip per
   * keystroke would buy nothing and cost a debounce to tune. The moment either
   * read grows a cursor, this has to move with it.
   */
  const [filter, setFilter] = useState<EntryFilter>('all')
  const [search, setSearch] = useState('')

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return rows.filter((row) => {
      if (filter !== 'all' && !FILTER_MATCHES[filter](row.status)) return false
      if (!needle) return true
      // The doc number is what somebody pastes in from a provider or a Slack
      // thread, so it is searched alongside the memo.
      return (
        row.title.toLowerCase().includes(needle) ||
        (row.docNumber?.toLowerCase().includes(needle) ?? false)
      )
    })
  }, [rows, filter, search])

  const isNarrowed = filter !== 'all' || search.trim().length > 0

  // 🛑 Drafts only, and only a `ledger.post` holder. A posting row's `id` is a
  // `GlPosting` id, not a journal-entry id, and a posted entry is corrected by
  // REVERSING it - offering Discard on one would be a second path around ground
  // rule 6, which is exactly what this brief must not open.
  const canDiscard = can('ledger.post')

  return (
    /* 🛑 `INSET` on every child EXCEPT the toolbar. The `Section` around this
       list carries `SECTION_BLEED`, which strips the section's own `p-3` off the
       whole content so the `ListToolbar` can run edge to edge - and that takes
       the rows, the refusal card and the empty states with it, leaving their
       borders flush against the section's. Each one puts the 12px back. */
    <div className='flex flex-col gap-3'>
      {/* 🛑 A refusal is a card, never a toast (ground rule 9). It names the
          entry and points at reversal, and it stays until the next attempt. */}
      {discard.refusal && (
        <div className={INSET}>
          <EntryBlockers blockers={[{ status: 'discard_refused', error: discard.refusal }]} />
        </div>
      )}

      {!loading && rows.length === 0 ? (
        <EmptySection
          className={INSET}
          icon={<FileText className='size-5' />}
          title={periodKey ? 'No other entries this month' : 'No journal entries yet'}
          description={
            periodKey
              ? 'Postings and drafts dated in this month land here. The month-end entry is shown above, not in this list.'
              : 'Raise one with New journal entry. It posts into whichever month its own date falls in.'
          }
        />
      ) : (
        <>
          {/* 🛑 `sticky={false}`. This toolbar lives inside a `Section` partway
              down the page's own `ScrollArea`, not at the top of its own list
              viewport - stuck to the top it would float over the entry above
              it. Same call `review-toolbar.tsx` makes for its two rows.
              
              ⚠️ No bleed class of its own. The `Section` that wraps this list
              carries `SECTION_BLEED`, so the toolbar is already flush with the
              section's edges; a second `-mx` here would push it past them. */}
          <ListToolbar sticky={false}>
            <ListToolbarGroup className='shrink-0'>
              {/* 🛑 `sm`, never `xs`. The `xs` item variant is a fixed `size-5`
                  SQUARE meant for icon-only tabs - five text labels under it
                  collapse on top of each other and on the search field beside
                  them. `sm` is what `review-toolbar.tsx` uses for the same
                  shape. */}
              <RadioTab
                value={filter}
                onValueChange={(next) => setFilter(next as EntryFilter)}
                size='sm'>
                {FILTERS.map((option) => (
                  <RadioTabItem key={option.value} value={option.value} tooltip={option.tooltip}>
                    {option.label}
                  </RadioTabItem>
                ))}
              </RadioTab>
            </ListToolbarGroup>

            <InputSearch
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onClear={() => setSearch('')}
              placeholder='Search memo or document number'
            />

            <ListToolbarGroup align='end' className='shrink-0'>
              <span className='px-1 text-xs text-muted-foreground tabular-nums'>
                {isNarrowed ? `${visible.length} of ${rows.length}` : `${rows.length}`}
              </span>
            </ListToolbarGroup>
          </ListToolbar>

          {!loading && visible.length === 0 ? (
            /* ⚠️ A FILTERED-empty state, not a first-run one - it names how many
               rows the filter is hiding so the answer is "narrow differently",
               not "there is nothing here". The `rows.length === 0` branch above
               is the other one. */
            <EmptySection
              className={INSET}
              icon={<SearchX className='size-5' />}
              title='No entries match'
              description={`${rows.length} ${rows.length === 1 ? 'entry is' : 'entries are'} hidden by the filter.`}
            />
          ) : (
            <TreeRowList
              className={INSET}
              items={visible}
              loading={loading}
              skeletonCount={2}
              visibleLimit={VISIBLE_LIMIT}
              showMoreIcon={<FileText className='size-4 text-muted-foreground' />}
              showMoreLabel={(hidden) =>
                `Show ${hidden} more ${hidden === 1 ? 'entry' : 'entries'}`
              }
              getKey={(row) => row.key}
              renderRow={(row) => (
                <TreeRow
                  className={TREE_SECONDARY_NOTRUNCATE}
                  icon={<FileText className='size-4' />}
                  title={<span className='truncate text-sm'>{row.title}</span>}
                  secondary={
                    <span className='flex items-center gap-1.5'>
                      {row.docNumber && (
                        <Badge variant='outline' size='xs' className='font-mono'>
                          {row.docNumber}
                        </Badge>
                      )}
                      <span className='font-mono text-xs tabular-nums'>
                        {formatMinor(row.amountMinor, currencyCode)}
                      </span>
                      <span className='flex items-center gap-1 text-xs text-muted-foreground'>
                        <span
                          className={cn('size-1.5 rounded-full', STATUS_DOT[row.status])}
                          aria-hidden
                        />
                        {STATUS_LABEL[row.status]}
                      </span>
                    </span>
                  }
                  actions={
                    row.kind === 'draft' && canDiscard ? (
                      <TreeRowButton
                        variant='destructive'
                        // An icon-only button has no accessible name of its own
                        // - the tooltip is `aria-describedby`, not a label.
                        aria-label={`Discard this draft${row.number ? ` (${row.number})` : ''}`}
                        tooltipText='Discard this draft'
                        disabled={discard.isDiscarding}
                        onClick={() =>
                          void discard.requestDiscard({ id: row.id, number: row.number })
                        }>
                        <Trash2 />
                      </TreeRowButton>
                    ) : undefined
                  }
                  onToggleOpen={() =>
                    row.kind === 'posting' ? onSelectPosting(row.id) : onSelectJournalEntry(row.id)
                  }
                />
              )}
            />
          )}
        </>
      )}

      <discard.ConfirmDialog />
    </div>
  )
}
