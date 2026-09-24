// apps/web/src/components/accounting/ui/setup-wizard/use-connect-and-go.ts
'use client'

import { detectTimezone } from '@auxx/config/client'
import type {
  ConnectAndGoCompleteReport,
  ConnectAndGoPrepareReport,
} from '@auxx/lib/accounting/connect-and-go/client'
import { isMonthKey, isValidTimeZone } from '@auxx/lib/accounting/ledger/client'
import type { SettingValue } from '@auxx/lib/settings/client'
import { toastError } from '@auxx/ui/components/toast'
import { useRef, useState } from 'react'
import {
  useDehydratedOrganizationId,
  useDehydratedSettings,
  useDehydratedStateContext,
} from '~/providers/dehydrated-state-provider'
import { api } from '~/trpc/react'
import { EXPORT_ROW_DRAFT_KEYS } from '../settings/posting-page-model'

/** The person's answers across the import pages, held until Finish. */
export interface ConnectAndGoDraft {
  cutoffPeriod: string
  bookTimeZone: string
  fiscalYearStartMonth: number
  exportMode: 'transaction' | 'summary'
  /** `accounting.autoSend.*` / `accounting.summaryGrain.*`, keyed by setting key. */
  exportSettings: Partial<Record<string, SettingValue>>
  railBanks: Record<string, string | null>
  acceptBankAccounts: string[]
}

const EMPTY_DRAFT: ConnectAndGoDraft = {
  cutoffPeriod: '',
  bookTimeZone: '',
  fiscalYearStartMonth: 1,
  exportMode: 'transaction',
  exportSettings: {},
  railBanks: {},
  acceptBankAccounts: [],
}

/**
 * The import path's state, owned by the wizard shell so every import page shares one prepare
 * report and one draft. Nothing is written until `finish`. See plans/accounting/tasks/105 §4.
 */
export function useConnectAndGo(providerLabel: string) {
  const organizationId = useDehydratedOrganizationId()
  const savedSettings = useDehydratedSettings()
  const { patchSettings } = useDehydratedStateContext()
  const utils = api.useUtils()

  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const started = useRef(false)
  const prepare = api.ledger.connectAndGo.prepare.useMutation()
  // Own state, not `prepare.isPending`: a mount-effect call detaches from the observer under
  // StrictMode's remount, so `isPending` never clears even though the call resolves.
  const [preparing, setPreparing] = useState(false)
  const [prepareFailed, setPrepareFailed] = useState(false)
  const complete = api.ledger.connectAndGo.complete.useMutation({
    onError: (error) => toastError({ title: 'Could not finish setup', description: error.message }),
  })

  const [report, setReport] = useState<ConnectAndGoPrepareReport | null>(null)
  const [outcome, setOutcome] = useState<ConnectAndGoCompleteReport | null>(null)
  const [draft, setDraft] = useState<ConnectAndGoDraft>(EMPTY_DRAFT)
  const seeded = useRef(false)

  const runPrepare = async () => {
    setPreparing(true)
    setPrepareFailed(false)
    let next: ConnectAndGoPrepareReport
    try {
      next = await prepare.mutateAsync()
    } catch (error) {
      // The run queued on connect holds the setup lock; wait for it rather than failing.
      if ((error as { data?: { code?: string } }).data?.code === 'CONFLICT') {
        retryTimer.current = setTimeout(() => void runPrepare(), 5_000)
        return
      }
      setPreparing(false)
      setPrepareFailed(true)
      toastError({
        title: `Could not set up from ${providerLabel}`,
        description: error instanceof Error ? error.message : String(error),
      })
      return
    }
    setPreparing(false)
    setReport(next)
    // Prepare rewrites the chart and role map; the Mapping page reads them live.
    void utils.ledger.invalidate()
    // A refresh keeps what the person already typed.
    if (!seeded.current) {
      seeded.current = true
      setDraft((prev) => ({
        ...prev,
        cutoffPeriod: next.proposedCutover.cutoffPeriod,
        bookTimeZone: next.bookTimeZone || detectTimezone(),
        fiscalYearStartMonth: next.fiscalYearStartMonth,
        exportMode: next.exportMode,
        exportSettings: Object.fromEntries(
          EXPORT_ROW_DRAFT_KEYS.map((key) => [key, savedSettings[key] ?? null])
        ),
      }))
    }
  }

  /** Runs prepare once per wizard visit; the first import page calls it on mount. */
  const start = () => {
    if (started.current) return
    started.current = true
    void runPrepare()
  }

  /** Forget this visit, for when the dialog reopens. */
  const reset = () => {
    if (retryTimer.current) clearTimeout(retryTimer.current)
    started.current = false
    setReport(null)
    setOutcome(null)
    setDraft(EMPTY_DRAFT)
    seeded.current = false
    setPrepareFailed(false)
  }

  const booksInvalid = !isMonthKey(draft.cutoffPeriod)
    ? 'Enter the cutover month as YYYY-MM.'
    : !isValidTimeZone(draft.bookTimeZone)
      ? `"${draft.bookTimeZone}" is not a valid IANA timezone.`
      : null

  const finish = async () => {
    const exportSettings = Object.entries(draft.exportSettings).flatMap(([key, value]) =>
      typeof value === 'boolean' || typeof value === 'string' ? [{ key, value }] : []
    )
    const result = await complete
      .mutateAsync({
        cutoffPeriod: draft.cutoffPeriod,
        answers: {
          railBanks: Object.entries(draft.railBanks).flatMap(([paymentGatewayId, glAccountId]) =>
            glAccountId ? [{ paymentGatewayId, glAccountId }] : []
          ),
          acceptBankAccounts: draft.acceptBankAccounts,
          bookTimeZone: draft.bookTimeZone,
          fiscalYearStartMonth: draft.fiscalYearStartMonth,
          exportMode: draft.exportMode,
          exportSettings,
        },
      })
      .catch(() => null)
    if (!result) return
    setOutcome(result)
    // The run returns every setting it can touch, read back, so no page keeps a stale copy.
    if (organizationId) patchSettings(organizationId, result.settings)
    // Finish touches the whole ledger (periods, balance, batches, roles, chart), so every
    // accounting page refetches rather than each one being listed here.
    await Promise.all([
      utils.gettingStarted.getStatus.invalidate(),
      utils.ledgerOpening.invalidate(),
      utils.ledger.invalidate(),
    ])
    if (!result.completed) {
      toastError({
        title: 'Setup stopped before the end',
        description: result.message ?? 'A step refused. Fix it and finish again.',
      })
    }
  }

  const done = !!report?.finalized || outcome?.completed === true

  return {
    report,
    outcome,
    draft,
    patchDraft: (patch: Partial<ConnectAndGoDraft>) => setDraft((prev) => ({ ...prev, ...patch })),
    start,
    reset,
    refresh: runPrepare,
    preparing,
    prepareFailed,
    finish,
    finishing: complete.isPending,
    booksInvalid,
    done,
  }
}

export type ConnectAndGoFlow = ReturnType<typeof useConnectAndGo>
