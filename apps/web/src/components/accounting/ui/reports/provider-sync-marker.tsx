// apps/web/src/components/accounting/ui/reports/provider-sync-marker.tsx

'use client'

import { describeProviderSyncCoverage } from '@auxx/lib/postings/client'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { CloudOff, RefreshCw, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { api } from '~/trpc/react'

/**
 * The amber, on the row itself.
 *
 * `TreeRow`'s own line is `text-muted-foreground hover:bg-background`, so a
 * tone has to name the resting fill, the hover fill and the text in both
 * schemes or the row loses its tint the moment a cursor crosses it. The values
 * are the `warning` `Alert` variant's, deliberately - this row replaced that
 * Alert and must not read as a second, differently-yellow kind of warning.
 */
const WARNING_ROW =
  'bg-yellow-50 text-yellow-700 hover:bg-yellow-100 dark:bg-yellow-950/20 dark:text-yellow-500 dark:hover:bg-yellow-950/40'

export interface ProviderSyncMarkerProps {
  /**
   * The LAST date this statement covers - `asOf` for a balance sheet, an aging
   * or a trial balance, `to` for a P&L or a general ledger. Empty while the
   * page has not resolved a period yet, which renders nothing.
   */
  through: string
}

/**
 * "Synced through <date>", on every statement of an org with a connected
 * accounting provider (`plans/accounting/tasks/20-two-authors-one-ledger.md`
 * §7.3).
 *
 * The accounting firm posts December's depreciation in February. auxx's
 * December balance sheet is incomplete until the sync runs and restates it, and
 * then it changes. A statement that changes two months after the reader last
 * looked at it, with nothing on the page saying so, is a trust problem rather
 * than a correctness one - and the only thing that fixes it is the statement
 * saying so on its own face.
 *
 * 🛑 **An org with NO provider connected renders nothing at all** - not "synced
 * through: never", not an empty strip. The marker is meaningless there and it
 * would imply a connection exists. Same for a transport error and for a
 * statement that has not resolved its own range yet: a missing line is a much
 * smaller problem than a wrong one, which is `CompletenessBanner`'s rule and
 * this follows it.
 *
 * Three visible readings, and the middle one is the reason the feature exists:
 *
 *   * **behind** - the statement's range ends after the marker. Named as
 *     "incomplete after <date>", with what is missing and that the figures will
 *     change, because a date on its own leaves the reader to do the comparison
 *     the page has already done.
 *   * **never synced** - connected, nothing read yet. Same shape, different
 *     sentence: everything the accountant authored is missing.
 *   * **current** - one quiet muted line. Deliberately not a card: a books-
 *     complete statement should not carry a box telling it so, the same
 *     argument `CompletenessBanner` makes by rendering nothing at all when
 *     there is nothing to say.
 *
 * 🛑 The two loud readings are a `TreeRow` ADJACENT to `CompletenessBanner`'s,
 * not an `Alert`. The pair answer one question between them - "what should I
 * know before reading these figures" - and as a tinted card above a bare row
 * they read as two unrelated objects, the card shouting the smaller of the two
 * facts. One row each, the detail under the chevron, and the amber lives in
 * `WARNING_ROW` rather than in a box: the tone still separates it from the
 * neutral row above at a glance without spending four lines to do it.
 */
export function ProviderSyncMarker({ through }: ProviderSyncMarkerProps) {
  const { data } = api.ledgerReports.providerSyncMarker.useQuery(undefined, {
    // The marker moves only when a sync runs, and every statement page mounts
    // this. One shared, long-lived entry rather than a request per page.
    staleTime: 60_000,
  })
  const [isOpen, setIsOpen] = useState(false)

  if (!data?.connected || !through) return null

  const reading = describeProviderSyncCoverage(data, through)
  if (!reading.headline) return null

  if (reading.coverage === 'current') {
    return (
      <div className='flex items-center gap-2 px-1 text-xs text-muted-foreground'>
        <RefreshCw className='size-3.5' />
        <span>{reading.headline}</span>
      </div>
    )
  }

  const Icon = reading.coverage === 'never_synced' ? CloudOff : TriangleAlert

  return (
    <TreeRow
      expandable={!!reading.detail}
      isOpen={isOpen}
      onToggleOpen={() => setIsOpen((open) => !open)}
      rowClassName={WARNING_ROW}
      icon={<Icon className='size-4 text-yellow-600 dark:text-yellow-500' />}
      title={
        <span className='truncate text-yellow-700 dark:text-yellow-500'>{reading.headline}</span>
      }>
      {/* The reading's own sentence, as prose rather than as a child row - it is
          one explanation, not a list of items, which is the same split
          `entry-blockers.tsx` makes between its rows and its guidance line.
          `ps-6` clears the connector `BaseTreeRow` draws at the parent icon's
          center; at `px-1` the line ran straight through the text. */}
      {reading.detail && (
        <p className='pe-2 pt-1 pb-2 ps-6 text-muted-foreground text-sm'>{reading.detail}</p>
      )}
    </TreeRow>
  )
}
