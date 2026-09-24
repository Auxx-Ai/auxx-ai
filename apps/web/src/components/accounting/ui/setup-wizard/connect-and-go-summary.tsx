// apps/web/src/components/accounting/ui/setup-wizard/connect-and-go-summary.tsx
'use client'

import type {
  ConnectAndGoCompleteReport,
  ConnectAndGoCompleteStep,
  ConnectAndGoPrepareReport,
  ProviderAccountToCreate,
} from '@auxx/lib/accounting/connect-and-go/client'
import { PhaseList } from '@auxx/ui/components/phase-list'
import { Section } from '@auxx/ui/components/section'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { formatCurrency, pluralize } from '@auxx/utils'
import { ListChecks, ListPlus, Sparkles } from 'lucide-react'
import { useState } from 'react'

function stepLabels(
  providerLabel: string
): Record<ConnectAndGoCompleteReport['steps'][number]['step'], string> {
  return {
    cutover: 'Book settings saved',
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
  if (report.rolesMinted.length > 0)
    lines.push(`Added ${report.rolesMinted.map((row) => row.name).join(', ')} for what Auxx posts`)
  const railsCreated = report.rails?.created ?? []
  if (railsCreated.length > 0)
    lines.push(`Set up payment rails: ${railsCreated.map((rail) => rail.name).join(', ')}`)

  const failures = report.failures.map((failure) => failure.message)

  return (
    <Section
      title={`Done from ${providerLabel}`}
      icon={<Sparkles className='size-4 text-muted-foreground' />}
      collapsible={false}>
      {lines.length === 0 && report.failures.length === 0 ? (
        <p className='text-muted-foreground text-sm'>Everything was already in place.</p>
      ) : (
        <PhaseList
          phases={[...lines, ...failures]}
          labels={Object.fromEntries([...lines, ...failures].map((line) => [line, line]))}
          statuses={Object.fromEntries(failures.map((line) => [line, 'failed' as const]))}
          current={null}
          done
        />
      )}
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
        <PhaseList
          phases={report.steps.map((step) => step.step)}
          labels={
            Object.fromEntries(
              report.steps.map((step) => [
                step.step,
                `${labels[step.step]}${step.detail ? `: ${step.detail}` : ''}`,
              ])
            ) as Record<ConnectAndGoCompleteStep, string>
          }
          statuses={Object.fromEntries(report.steps.map((step) => [step.step, step.status]))}
          current={null}
        />
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
        rowClassName='bg-primary-100/50 hover:bg-primary-100'
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
              rowClassName='hover:bg-primary-100'
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
