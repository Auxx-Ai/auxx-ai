// apps/web/src/components/accounting/ui/reports/account-drill.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { CheckCircle2, TriangleAlert } from 'lucide-react'
import { parseAsString, useQueryState } from 'nuqs'
import { useCallback } from 'react'
import { api } from '~/trpc/react'
import { formatAccountLabel } from '../account-label'
import { formatMinor } from '../ledger/format'
import { GeneralLedgerView } from './general-ledger-view'
import type { ReportGridRow } from './report-grid-layout'
import { ReportPageLayout } from './report-page-layout'

/**
 * A statement row drilled into its account, on `?account=`, rendered on the
 * statement's own page (108 §3.4). Pushed to history so Back returns to the statement.
 */
export function useAccountDrill() {
  const [accountId, setAccountId] = useQueryState(
    'account',
    parseAsString.withOptions({ history: 'push' })
  )
  const open = useCallback((glAccountId: string) => void setAccountId(glAccountId), [setAccountId])
  const close = useCallback(() => void setAccountId(null), [setAccountId])
  return { accountId, open, close }
}

/** The statement row for an account, anywhere in the tree. */
export function findAccountRow(
  rows: readonly ReportGridRow[],
  glAccountId: string
): ReportGridRow | undefined {
  for (const row of rows) {
    if (row.meta?.glAccountId === glAccountId) return row
    const found = row.children ? findAccountRow(row.children, glAccountId) : undefined
    if (found) return found
  }
  return undefined
}

/** The drilled account's summary: its label for the breadcrumb, its figures for the check. */
export function useDrillAccount(glAccountId: string | null, from: string, to: string) {
  const query = api.ledgerReports.generalLedgerSummary.useQuery(
    { from, to, glAccountId: glAccountId ?? undefined },
    { enabled: !!glAccountId && !!from && !!to }
  )
  const account = glAccountId ? query.data?.accounts[0] : undefined
  const label = account
    ? account.nested
      ? account.label
      : formatAccountLabel({ code: account.accountCode, name: account.accountName })
    : null
  return { account, label }
}

export interface AccountDrillViewProps {
  reportLabel: string
  glAccountId: string
  from: string
  to: string
  /** The clicked row's figure. */
  figure: number | null | undefined
  /** What the figure is: a balance (trial balance, balance sheet) or activity over the range (P&L). */
  figureKind: 'balance' | 'activity'
  currency: string
}

/** The drilled account's ledger, with the clicked figure beside the ledger's own. */
export function AccountDrillView({
  reportLabel,
  glAccountId,
  from,
  to,
  figure,
  figureKind,
  currency,
}: AccountDrillViewProps) {
  const { account } = useDrillAccount(glAccountId, from, to)
  const ledgerFigure = account
    ? figureKind === 'balance'
      ? account.endingBalanceMinor
      : account.endingBalanceMinor - account.openingBalanceMinor
    : undefined

  return (
    <ReportPageLayout
      notices={
        figure != null && ledgerFigure !== undefined ? (
          <FigureCheck
            reportLabel={reportLabel}
            figure={figure}
            ledgerLabel={figureKind === 'balance' ? 'Ledger ending balance' : 'Ledger activity'}
            ledgerFigure={ledgerFigure}
            currency={currency}
          />
        ) : null
      }>
      <GeneralLedgerView
        key={glAccountId}
        from={from}
        to={to}
        glAccountId={glAccountId}
        currency={currency}
        reportKey='general-ledger'
      />
    </ReportPageLayout>
  )
}

function FigureCheck({
  reportLabel,
  figure,
  ledgerLabel,
  ledgerFigure,
  currency,
}: {
  reportLabel: string
  figure: number
  ledgerLabel: string
  ledgerFigure: number
  currency: string
}) {
  const ties = figure === ledgerFigure
  return (
    <div className='flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-sm'>
      {ties ? (
        <CheckCircle2 className='size-4 shrink-0 text-green-600 dark:text-green-400' />
      ) : (
        <TriangleAlert className='size-4 shrink-0 text-destructive' />
      )}
      <span>
        {reportLabel}:{' '}
        <span className='font-mono text-foreground tabular-nums'>
          {formatMinor(figure, currency)}
        </span>
      </span>
      <span aria-hidden>·</span>
      <span>
        {ledgerLabel}:{' '}
        <span
          className={cn('font-mono tabular-nums', ties ? 'text-foreground' : 'text-destructive')}>
          {formatMinor(ledgerFigure, currency)}
        </span>
      </span>
    </div>
  )
}
