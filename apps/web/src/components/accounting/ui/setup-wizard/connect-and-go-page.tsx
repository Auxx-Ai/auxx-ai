// apps/web/src/components/accounting/ui/setup-wizard/connect-and-go-page.tsx
'use client'

import { detectTimezone } from '@auxx/config/client'
import type {
  ConnectAndGoCompleteReport,
  ConnectAndGoPrepareReport,
} from '@auxx/lib/accounting/connect-and-go/client'
import { isMonthKey, isValidTimeZone } from '@auxx/lib/accounting/ledger/client'
import { Button } from '@auxx/ui/components/button'
import { EmptySection } from '@auxx/ui/components/section'
import { toastError } from '@auxx/ui/components/toast'
import { Check } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import {
  useDehydratedOrganizationId,
  useDehydratedStateContext,
} from '~/providers/dehydrated-state-provider'
import { api } from '~/trpc/react'
import {
  UNKNOWN_PROVIDER_LABEL,
  useAccountingProviderStatus,
} from '../../hooks/use-accounting-provider-status'
import { ConnectAndGoBacklog } from './connect-and-go-backlog'
import { type ConnectAndGoDraft, ConnectAndGoQuestions } from './connect-and-go-questions'
import { ConnectAndGoDoneList, ConnectAndGoStepList } from './connect-and-go-summary'

interface ConnectAndGoPageProps {
  /** Stamps the wizard completed and closes the dialog. */
  onFinish: () => void
}

/**
 * The setup wizard for an org with an accounting system connected: prepare runs on open, then
 * one screen of what was done, the few questions, the backlog, and Finish.
 * See plans/accounting/tasks/105-connect-and-go.md §4.
 */
export function ConnectAndGoPage({ onFinish }: ConnectAndGoPageProps) {
  const providerStatus = useAccountingProviderStatus()
  const providerLabel = providerStatus.providerLabel ?? UNKNOWN_PROVIDER_LABEL
  const organizationId = useDehydratedOrganizationId()
  const { patchSettings } = useDehydratedStateContext()
  const utils = api.useUtils()

  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prepare = api.ledger.connectAndGo.prepare.useMutation({
    onError: (error) => {
      // The run queued on connect holds the setup lock; wait for it rather than failing.
      if (error.data?.code === 'CONFLICT') {
        retryTimer.current = setTimeout(() => void runPrepare(), 5_000)
        return
      }
      toastError({ title: `Could not set up from ${providerLabel}`, description: error.message })
    },
  })
  const complete = api.ledger.connectAndGo.complete.useMutation({
    onError: (error) => toastError({ title: 'Could not finish setup', description: error.message }),
  })

  const [report, setReport] = useState<ConnectAndGoPrepareReport | null>(null)
  const [outcome, setOutcome] = useState<ConnectAndGoCompleteReport | null>(null)
  const [draft, setDraft] = useState<ConnectAndGoDraft>({
    cutoffPeriod: '',
    bookTimeZone: '',
    roles: {},
    railBanks: {},
    acceptBankAccounts: [],
  })

  const runPrepare = async () => {
    const next = await prepare.mutateAsync().catch(() => null)
    if (!next) return
    setReport(next)
    setDraft((prev) => ({
      ...prev,
      cutoffPeriod: prev.cutoffPeriod || next.proposedCutover.cutoffPeriod,
      bookTimeZone: prev.bookTimeZone || next.bookTimeZone || detectTimezone(),
    }))
  }

  const started = useRef(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: prepare runs once per open.
  useEffect(() => {
    if (started.current) return
    started.current = true
    void runPrepare()
    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current)
    }
  }, [])

  const invalid = !isMonthKey(draft.cutoffPeriod)
    ? 'Enter the cutover month as YYYY-MM.'
    : !report?.bookTimeZone && !isValidTimeZone(draft.bookTimeZone)
      ? `"${draft.bookTimeZone}" is not a valid IANA timezone.`
      : null

  const finish = async () => {
    const result = await complete
      .mutateAsync({
        cutoffPeriod: draft.cutoffPeriod,
        answers: {
          roles: Object.entries(draft.roles).flatMap(([role, glAccountId]) =>
            glAccountId ? [{ role, glAccountId }] : []
          ),
          railBanks: Object.entries(draft.railBanks).flatMap(([paymentGatewayId, glAccountId]) =>
            glAccountId ? [{ paymentGatewayId, glAccountId }] : []
          ),
          acceptBankAccounts: draft.acceptBankAccounts,
          bookTimeZone: report?.bookTimeZone ? null : draft.bookTimeZone,
        },
      })
      .catch(() => null)
    if (!result) return
    setOutcome(result)
    if (organizationId) {
      patchSettings(organizationId, {
        'accounting.cutoffPeriod': draft.cutoffPeriod,
        ...(report?.bookTimeZone ? {} : { 'accounting.bookTimeZone': draft.bookTimeZone }),
        ...(result.completed ? { 'accounting.setupState': 'finalized' } : {}),
      })
    }
    await Promise.all([
      utils.gettingStarted.getStatus.invalidate(),
      utils.ledgerOpening.get.invalidate(),
      utils.ledger.roleMap.invalidate(),
      utils.ledger.chartAccounts.invalidate(),
    ])
    if (!result.completed) {
      toastError({
        title: 'Setup stopped before the end',
        description: result.message ?? 'A step refused. Fix it and finish again.',
      })
    }
  }

  if (!report) {
    return (
      <div className='flex flex-col items-center gap-3 p-6'>
        {prepare.isPending || !prepare.isError || prepare.error?.data?.code === 'CONFLICT' ? (
          <>
            <EmptySection loading />
            <p className='text-muted-foreground text-sm'>
              Setting up from {providerLabel}. This reads your whole chart and can take a minute.
            </p>
          </>
        ) : (
          <Button variant='outline' size='sm' onClick={runPrepare}>
            Try again
          </Button>
        )}
      </div>
    )
  }

  const done = report.finalized || outcome?.completed === true
  const currencyCode = report.company?.homeCurrency ?? 'USD'

  return (
    <div className='flex flex-col'>
      <ConnectAndGoDoneList report={report} providerLabel={providerLabel} />

      {outcome && (
        <ConnectAndGoStepList
          report={outcome}
          providerLabel={providerLabel}
          currencyCode={currencyCode}
        />
      )}

      {done ? (
        <p className='px-4 py-3 text-muted-foreground text-sm'>
          Your opening is posted and the ledger is open. Everything after {draft.cutoffPeriod} now
          posts and exports on its own.
        </p>
      ) : (
        <>
          <ConnectAndGoQuestions
            report={report}
            draft={draft}
            onChange={(patch) => setDraft((prev) => ({ ...prev, ...patch }))}
            providerLabel={providerLabel}
            disabled={complete.isPending}
          />
          <ConnectAndGoBacklog
            cutoffPeriod={draft.cutoffPeriod}
            bookTimeZone={report.bookTimeZone ?? (draft.bookTimeZone || null)}
            providerLabel={providerLabel}
          />
          {invalid && <p className='px-4 pt-3 text-muted-foreground text-xs'>{invalid}</p>}
        </>
      )}

      <div className='flex flex-wrap items-center justify-end gap-2 p-4'>
        {done ? (
          <Button variant='outline' size='sm' asChild onClick={onFinish}>
            <Link href='/app/accounting'>Open the ledger</Link>
          </Button>
        ) : (
          <>
            <Button
              variant='ghost'
              size='sm'
              onClick={runPrepare}
              loading={prepare.isPending}
              loadingText='Refreshing...'
              disabled={complete.isPending}>
              Refresh from {providerLabel}
            </Button>
            <Button
              variant='outline'
              size='sm'
              onClick={finish}
              disabled={!!invalid || prepare.isPending}
              loading={complete.isPending}
              loadingText='Finishing...'
              data-dialog-submit>
              <Check />
              Finish setup
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
