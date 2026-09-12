// apps/web/src/components/money/ui/batch-posting/use-postable-months.ts
'use client'

/**
 * The months the month picker offers, read from the ledger's own periods (§6.3).
 *
 * `useLedgerPeriod` already returns every month from `accounting.cutoffPeriod`
 * forward with its close state, so feeding the picker from it rather than from a
 * free calendar turns two exclusion reasons into months that cannot be picked:
 * `before-cutoff` and `locked-period` stop being rows in the excluded list that
 * somebody has to read past after the fact.
 *
 * 🛑 Locked and pre-cutoff months are DISABLED WITH THE REASON, never hidden.
 * "Where is February" needs an answer on the screen.
 *
 * ⚠️ Both reasons stay in the server-side planner regardless. This is a
 * convenience: the plan is still computed server-side and the `auto` lane has no
 * picker at all.
 */

import type { MonthRangeOption } from '@auxx/ui/components/month-range-picker'
import { useMemo } from 'react'
import { useLedgerPeriod } from '~/components/accounting/hooks/use-ledger-period'

/**
 * How many months before the cutoff the picker still shows.
 *
 * `ledger.periods` starts the month AFTER `accounting.cutoffPeriod`, so every
 * month before its first row is pre-cutoff. Showing a handful of them is the
 * whole point of §6.3: a person looking for January of the year the books were
 * opened has to SEE that it is out of reach and why.
 */
const PRE_CUTOFF_MONTHS_SHOWN = 6

function monthOrdinal(key: string): number | null {
  const match = /^(\d{4})-(\d{2})$/.exec(key)
  if (!match) return null
  return Number(match[1]) * 12 + (Number(match[2]) - 1)
}

function monthKeyOf(ordinal: number): string {
  const year = Math.floor(ordinal / 12)
  const month = (ordinal % 12) + 1
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
}

export interface PostableMonths {
  /** Everything the picker renders, ascending, disabled ones included. */
  months: readonly MonthRangeOption[]
  /** The ones a run can actually be asked for, ascending. */
  selectable: readonly string[]
  isLoading: boolean
}

export function usePostableMonths(): PostableMonths {
  const { options, isLoading } = useLedgerPeriod()

  return useMemo(() => {
    const months: MonthRangeOption[] = []
    const selectable: string[] = []

    const firstOrdinal = monthOrdinal(options[0]?.periodKey ?? '')
    if (firstOrdinal !== null) {
      for (let back = PRE_CUTOFF_MONTHS_SHOWN; back > 0; back -= 1) {
        months.push({
          key: monthKeyOf(firstOrdinal - back),
          disabled: true,
          disabledReason: 'Before cutoff',
        })
      }
    }

    for (const option of options) {
      // 🛑 Only `locked` refuses a new entry. A `posted` month is a month that
      // already HAS an entry, which is exactly what a second source posts into.
      const locked = option.period.state === 'locked'
      months.push({
        key: option.periodKey,
        disabled: locked,
        disabledReason: locked ? 'Locked' : undefined,
      })
      if (!locked) selectable.push(option.periodKey)
    }

    return { months, selectable, isLoading }
  }, [options, isLoading])
}
