// apps/web/src/components/accounting/ui/setup-wizard/connect-and-go-summary.tsx
'use client'

import type {
  ConnectAndGoCompleteReport,
  ConnectAndGoPrepareReport,
  ProviderAccountToCreate,
} from '@auxx/lib/accounting/connect-and-go/client'
import { FISCAL_YEAR_START_MONTH_OPTIONS } from '@auxx/lib/accounting/reports/client'
import { Section } from '@auxx/ui/components/section'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { formatCurrency, pluralize } from '@auxx/utils'
import { AlertTriangle, Check, ListChecks, ListPlus, Minus, Sparkles } from 'lucide-react'
import { useState } from 'react'

function stepLabels(
  providerLabel: string
): Record<ConnectAndGoCompleteReport['steps'][number]['step'], string> {
  return {
    cutover: 'Cutover saved',
    roles: 'Accounts chosen',
    rail_banks: 'Rail banks chosen',
    bank_accounts: 'Bank accounts added',
    provider_accounts: `Accounts created in ${providerLabel}`,
    book_connection: 'Exports switched on',
    opening: 'Opening filled',
    finalize: 'Setup finalized, opening posted',
    inventory_adjustment: 'Inventory adjusted',
  }
}

/** One line per thing prepare did, then prepare's refusals. */
export function ConnectAndGoDoneList({
  report,
  providerLabel,
}: {
  report: ConnectAndGoPrepareReport
  providerLabel: string
}) {
  const lines: string[] = []
  const chart = report.chart
  if (chart) {
    const { result } = chart
    lines.push(
      chart.mode === 'full'
        ? `Imported your chart from ${providerLabel}: ${result.created} accounts`
        : `Chart checked against ${providerLabel}: ${result.created} new, ${result.alreadyImported} already here`
    )
    if (chart.suggestionsLinked > 0)
      lines.push(`Linked ${chart.suggestionsLinked} existing accounts to ${providerLabel}`)
    if (result.rolesAssigned.length > 0)
      lines.push(`Mapped ${result.rolesAssigned.length} account roles`)
    if (result.coreCreated.length > 0)
      lines.push(`Added ${result.coreCreated.length} accounts ${providerLabel} has no match for`)
  }
  if (report.fiscalYearStartMonthWritten)
    lines.push(
      `Fiscal year starts in ${FISCAL_YEAR_START_MONTH_OPTIONS[report.fiscalYearStartMonthWritten - 1]?.label}`
    )
  if (report.bookTimeZoneWritten && report.bookTimeZone)
    lines.push(`Books kept in ${report.bookTimeZone}`)
  if (report.rolesMinted.length > 0)
    lines.push(`Added ${report.rolesMinted.map((row) => row.name).join(', ')} for what Auxx posts`)
  const railsCreated = report.rails?.created ?? []
  if (railsCreated.length > 0)
    lines.push(`Set up payment rails: ${railsCreated.map((rail) => rail.name).join(', ')}`)

  return (
    <Section
      title={`Done from ${providerLabel}`}
      icon={<Sparkles className='size-4 text-muted-foreground' />}
      collapsible={false}>
      <ul className='flex flex-col gap-1'>
        {lines.length === 0 && (
          <li className='text-muted-foreground text-sm'>Everything was already in place.</li>
        )}
        {lines.map((line) => (
          <li key={line} className='flex items-start gap-1.5 text-sm'>
            <Check className='mt-0.5 size-3.5 shrink-0 text-green-600' />
            <span>{line}</span>
          </li>
        ))}
        {report.failures.map((failure) => (
          <li
            key={`${failure.step}:${failure.message}`}
            className='flex items-start gap-1.5 text-muted-foreground text-sm'>
            <AlertTriangle className='mt-0.5 size-3.5 shrink-0 text-amber-500' />
            <span>{failure.message}</span>
          </li>
        ))}
      </ul>
    </Section>
  )
}

/** Each finish step's outcome, up to the one that stopped the run. */
export function ConnectAndGoStepList({
  report,
  providerLabel,
  currencyCode,
}: {
  report: ConnectAndGoCompleteReport
  providerLabel: string
  currencyCode: string
}) {
  const adjustment = report.inventoryAdjustment
  const labels = stepLabels(providerLabel)
  return (
    <Section
      title='Finishing'
      icon={<ListChecks className='size-4 text-muted-foreground' />}
      collapsible={false}>
      <div className='flex flex-col gap-2'>
        <ul className='flex flex-col gap-1'>
          {report.steps.map((step) => (
            <li key={step.step} className='flex items-start gap-1.5 text-sm'>
              {step.status === 'done' ? (
                <Check className='mt-0.5 size-3.5 shrink-0 text-green-600' />
              ) : step.status === 'skipped' ? (
                <Minus className='mt-0.5 size-3.5 shrink-0 text-muted-foreground' />
              ) : (
                <AlertTriangle className='mt-0.5 size-3.5 shrink-0 text-amber-500' />
              )}
              <span className={step.status === 'done' ? '' : 'text-muted-foreground'}>
                {labels[step.step]}
                {step.detail ? ` — ${step.detail}` : ''}
              </span>
            </li>
          ))}
        </ul>
        {adjustment && adjustment.differenceMinor !== 0 && (
          <p className='text-muted-foreground text-xs'>
            Your parts on hand differ from the inventory {providerLabel} reported at the cutover by{' '}
            {formatCurrency(Math.abs(adjustment.differenceMinor), { currencyCode })}.{' '}
            {adjustment.status
              ? 'One adjustment dated the day after the cutover brings both books to the shelf.'
              : 'The adjustment has not posted yet.'}
          </p>
        )}
      </div>
    </Section>
  )
}

/** Our accounts Finish creates in the provider, under one collapsed row. */
export function ConnectAndGoProviderAccounts({
  accounts,
  providerLabel,
}: {
  accounts: ProviderAccountToCreate[]
  providerLabel: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <Section
      title={`Will be added to ${providerLabel} when you finish`}
      description={`Nothing is written to ${providerLabel} before then.`}
      icon={<ListPlus className='size-4 text-muted-foreground' />}
      collapsible={false}>
      <TreeRow
        expandable
        isOpen={open}
        onToggleOpen={() => setOpen((value) => !value)}
        icon={<ListPlus className='size-4 text-muted-foreground' />}
        title={<span className='truncate text-sm'>Accounts only Auxx has</span>}
        secondary={
          <span className='text-muted-foreground text-xs tabular-nums'>
            {accounts.length} {pluralize(accounts.length, 'account')}
          </span>
        }>
        <TreeRowList
          items={accounts}
          getKey={(account) => account.glAccountId}
          renderRow={(account) => (
            <TreeRow
              depth={1}
              title={
                <span className='truncate text-sm'>
                  {account.code ? `${account.code} · ${account.name}` : account.name}
                </span>
              }
            />
          )}
        />
      </TreeRow>
    </Section>
  )
}
