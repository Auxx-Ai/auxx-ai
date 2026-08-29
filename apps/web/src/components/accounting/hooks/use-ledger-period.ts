// apps/web/src/components/accounting/hooks/use-ledger-period.ts

'use client'

import { type ClosePeriod, FINALIZED_SETUP_STATE } from '@auxx/lib/postings/client'
import { useMemo } from 'react'
import { formatPeriodLabel } from '~/components/accounting/ui/ledger/format'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'

/** The org's book time zone, when `accounting.bookTimeZone` has never been set. */
const FALLBACK_BOOK_TIME_ZONE = 'UTC'

export interface LedgerPeriodOption {
  periodKey: string
  label: string
  period: ClosePeriod
}

export interface LedgerPeriodModel {
  /**
   * Setup is not finalized, so the module home renders the checklist instead of
   * a month. Read from `accounting.setupState`, which is the same key the wizard
   * writes and the same one `readOpeningBaseline` refuses on server-side.
   */
  isSetupDraft: boolean
  /** The period list is still in flight. Gate "nothing to close" copy on this. */
  isLoading: boolean
  /** Cutoff + 1 through the current month, oldest first. */
  options: LedgerPeriodOption[]
  /** Earliest open month, else the most recent posted one. */
  resolvedPeriodKey: string
  /** What the screen is actually showing. */
  activePeriodKey: string
  activePeriod: ClosePeriod | undefined
  previousPeriodKey: string | null
  nextPeriodKey: string | null
  /** False once every month from the cutoff forward is posted or locked. */
  hasOpenPeriod: boolean
  /** The zone the period boundaries were drawn in. Never the viewer's zone. */
  bookTimeZone: string
  currencyCode: string
}

/**
 * Everything the ledger screens need to know about WHICH month they are on.
 *
 * Every month's state is derived server-side from `GlPosting` rows plus
 * `accounting.cutoffPeriod` and `ledger.lockedThroughMonth`, with no new table
 * (14-drive-the-close.md section 6). `ledger.periods` returns the months from
 * the cutoff forward, oldest first; nothing about the list is computed here
 * beyond the navigation answers the toolbar asks for.
 *
 * ⚠️ The `?state=` and `?provider=` dev toggles that used to live here are gone
 * with the fixtures. Whether a provider is connected is not a property of a
 * period at all - it comes from `useAccountingProviderStatus()`, which reads the
 * installed-app and connection state directly.
 */
export function useLedgerPeriod(periodKey?: string): LedgerPeriodModel {
  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const periodsQuery = api.ledger.periods.useQuery()

  const setupState = getSetting('accounting.setupState')
  const bookTimeZone = (getSetting('accounting.bookTimeZone') as string) || FALLBACK_BOOK_TIME_ZONE
  const currencyCode = (getSetting('organization.currency') as string) || 'USD'
  const isSetupDraft = setupState !== FINALIZED_SETUP_STATE

  const periods = periodsQuery.data

  return useMemo(() => {
    const rows: ClosePeriod[] = periods ?? []
    const byKey = new Map(rows.map((row) => [row.periodKey, row]))
    const options: LedgerPeriodOption[] = rows.map((row) => ({
      periodKey: row.periodKey,
      label: formatPeriodLabel(row.periodKey),
      period: row,
    }))

    const firstOpen = options.find((option) => option.period.state === 'open')
    const lastPosted = [...options].reverse().find((option) => option.period.state !== 'open')
    const resolvedPeriodKey =
      firstOpen?.periodKey ?? lastPosted?.periodKey ?? options[options.length - 1]?.periodKey ?? ''

    const requested = periodKey && byKey.has(periodKey) ? periodKey : resolvedPeriodKey
    const index = options.findIndex((option) => option.periodKey === requested)

    return {
      isSetupDraft,
      isLoading: periodsQuery.isPending,
      options,
      resolvedPeriodKey,
      activePeriodKey: requested,
      activePeriod: byKey.get(requested),
      previousPeriodKey: index > 0 ? (options[index - 1]?.periodKey ?? null) : null,
      nextPeriodKey:
        index >= 0 && index < options.length - 1 ? (options[index + 1]?.periodKey ?? null) : null,
      hasOpenPeriod: !!firstOpen,
      bookTimeZone,
      currencyCode,
    }
  }, [bookTimeZone, currencyCode, isSetupDraft, periodKey, periods, periodsQuery.isPending])
}
