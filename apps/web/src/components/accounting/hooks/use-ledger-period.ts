// apps/web/src/components/accounting/hooks/use-ledger-period.ts

'use client'

import { useQueryState } from 'nuqs'
import { useMemo } from 'react'
import {
  FIXTURE_PERIOD_SUMMARIES,
  FIXTURE_PERIODS,
  type FixturePeriodSummary,
} from '~/components/accounting/fixtures'
import { formatPeriodLabel } from '~/components/accounting/ui/ledger/format'

/**
 * Which of the module home's three states the ledger is in
 * (plans/money/tasks/13-accounting-ui.md §5.1), plus `blocked`.
 *
 * `blocked` is not a fourth ORG state. It is the open state with a refused
 * preview, and it is selectable here only so the blocker treatment can be seen
 * before `ledger.previewMonthEnd` exists to produce one.
 */
export type LedgerScreenState = 'checklist' | 'open' | 'blocked' | 'posted'

const SCREEN_STATES: LedgerScreenState[] = ['checklist', 'open', 'blocked', 'posted']

export interface LedgerPeriodOption {
  periodKey: string
  label: string
  summary: FixturePeriodSummary
}

export interface LedgerPeriodModel {
  screenState: LedgerScreenState
  setScreenState: (state: LedgerScreenState) => void
  /** Whether a provider is treated as connected. Placeholder toggle, see below. */
  providerConnected: boolean
  setProviderConnected: (connected: boolean) => void
  /** Cutoff through now, oldest first. */
  options: LedgerPeriodOption[]
  /** Earliest unposted month, else the most recent posted one. */
  resolvedPeriodKey: string
  /** What the screen is actually showing. */
  activePeriodKey: string
  activeSummary: FixturePeriodSummary | undefined
  previousPeriodKey: string | null
  nextPeriodKey: string | null
  /** False once every month from the cutoff forward is posted or locked. */
  hasOpenPeriod: boolean
}

/**
 * Everything the ledger screens need to know about WHICH month they are on.
 *
 * 🛑 PLACEHOLDER. Both the period list and each month's state come from
 * `~/components/accounting/fixtures`. The real version derives all of it from
 * `GlPosting` rows plus `accounting.cutoffPeriod` and `ledger.lockedThroughMonth`,
 * with no new table, per 13-accounting-ui.md §5.1.
 *
 * ⚠️ `?state=` and `?provider=` are DEV TOGGLES and nothing else. They exist so
 * every screen state is reachable while the four procedures in §4 are still
 * missing; both disappear with the fixtures.
 */
export function useLedgerPeriod(periodKey?: string): LedgerPeriodModel {
  const [stateParam, setStateParam] = useQueryState('state')
  const [providerParam, setProviderParam] = useQueryState('provider')

  const screenState: LedgerScreenState = SCREEN_STATES.includes(stateParam as LedgerScreenState)
    ? (stateParam as LedgerScreenState)
    : 'open'

  const providerConnected = providerParam !== 'none'

  return useMemo(() => {
    // In the everything-posted state the open month is treated as closed, so the
    // "nothing to close" body has a posted month to render behind it.
    const summaries: FixturePeriodSummary[] = FIXTURE_PERIOD_SUMMARIES.map((summary) =>
      screenState === 'posted' && summary.state === 'open'
        ? {
            ...summary,
            state: 'posted',
            docNumber: `AUXX-MEI-${summary.periodKey}`,
            totalMinor: 981_000,
            postedAt: '2027-04-02T10:12:00.000Z',
          }
        : summary
    )

    const byKey = new Map(summaries.map((summary) => [summary.periodKey, summary]))
    const options: LedgerPeriodOption[] = FIXTURE_PERIODS.map((key) => {
      const summary = byKey.get(key) ?? { periodKey: key, state: 'open' as const, revision: 0 }
      return { periodKey: key, label: formatPeriodLabel(key), summary }
    })

    const firstOpen = options.find((option) => option.summary.state === 'open')
    const lastPosted = [...options].reverse().find((option) => option.summary.state !== 'open')
    const resolvedPeriodKey =
      firstOpen?.periodKey ?? lastPosted?.periodKey ?? options[options.length - 1]?.periodKey ?? ''

    const requested = periodKey && byKey.has(periodKey) ? periodKey : resolvedPeriodKey
    const index = options.findIndex((option) => option.periodKey === requested)

    return {
      screenState,
      setScreenState: (next: LedgerScreenState) => {
        void setStateParam(next === 'open' ? null : next)
      },
      providerConnected,
      setProviderConnected: (connected: boolean) => {
        void setProviderParam(connected ? null : 'none')
      },
      options,
      resolvedPeriodKey,
      activePeriodKey: requested,
      activeSummary: byKey.get(requested),
      previousPeriodKey: index > 0 ? (options[index - 1]?.periodKey ?? null) : null,
      nextPeriodKey:
        index >= 0 && index < options.length - 1 ? (options[index + 1]?.periodKey ?? null) : null,
      hasOpenPeriod: !!firstOpen,
    }
  }, [periodKey, providerConnected, screenState, setProviderParam, setStateParam])
}
