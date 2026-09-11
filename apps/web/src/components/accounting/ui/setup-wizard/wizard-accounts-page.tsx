// apps/web/src/components/accounting/ui/setup-wizard/wizard-accounts-page.tsx
'use client'

import {
  ACCOUNT_ROLE_LABELS,
  type AccountRole,
  CHART_PACK_KEYS,
  CHART_PACKS,
  type ChartPackKey,
  type RoleAssignmentState,
} from '@auxx/lib/postings/client'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { EmptySection } from '@auxx/ui/components/section'
import { toastError } from '@auxx/ui/components/toast'
import { ArrowUpRight } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { AccountLabel } from '~/components/accounting/ui/account-label'
import { api } from '~/trpc/react'
import { useAccountingProviderStatus } from '../../hooks/use-accounting-provider-status'
import { defaultSelectedPacks, forcedPacks, resolveSelectedPacks } from '../settings/accounts-types'
import { ImportChartButton } from '../settings/import-chart-button'

const ROLES_HREF = '/app/accounting/settings/accounts?s=roles'
const CHART_HREF = '/app/accounting/settings/accounts?s=chart'

const STATE_BADGE: Record<
  RoleAssignmentState,
  { label: string; variant: 'green' | 'amber' | 'destructive' | 'gray' }
> = {
  confirmed: { label: 'Confirmed', variant: 'green' },
  suggested: { label: 'Suggested', variant: 'amber' },
  unmapped: { label: 'Not mapped', variant: 'destructive' },
  unused: { label: 'Not used', variant: 'gray' },
}

/** Display order: the ones needing attention first, then confirmed, then excused. */
const STATE_ORDER: Record<RoleAssignmentState, number> = {
  unmapped: 0,
  suggested: 1,
  confirmed: 2,
  unused: 3,
}

/**
 * Page 5 of `AccountingSetupWizard` - a READ-ONLY summary of the account role map.
 *
 * 🛑 Deliberately not an editor. The full map, with the account picker and the reason each account
 * was suggested, lives on `settings/accounts` and this page links there rather than shipping a
 * second copy that could disagree with it. Dispatch's workers page does the same thing.
 *
 * ⚠️ Two roles typically ship excused rather than unmapped, and that is a decision. Nothing emits
 * `ppv` under L1 (purchase price variance is a report, not a posting) and `inventory_wip` is
 * structurally unreachable, so a map that demanded every role would block every Preview on two
 * roles nothing can ever post to.
 *
 * 🛑 `ledger.roleMap` returns a row for EVERY role, mapped or not, so the counts below are a
 * checklist rather than a tally of the rows that happen to exist. The list is not rendered until
 * the query answers: "0 confirmed" is a claim about the organization, and showing it during
 * the load would be a false one on the one screen whose whole job is telling somebody what is left
 * to do.
 *
 * Over an EMPTY chart (`chartIsEmpty` below), this renders two cards instead: import the org's
 * real QuickBooks chart (`ImportChartButton mode='wizard'`), or provision a picked set of chart
 * packs (brief 16 §3.2) - `core` always, `card_rail` pre-checked when a card rail already exists.
 */
export function WizardAccountsPage() {
  const roleMap = api.ledger.roleMap.useQuery()
  const chart = api.ledger.chartAccounts.useQuery()
  const utils = api.useUtils()
  const provider = useAccountingProviderStatus()
  const paymentRailsPresent = api.ledger.paymentRailsPresent.useQuery()

  // The pack picker's selection. `core` is always in it (checked and disabled
  // below); `card_rail` is added once, the moment `paymentRailsPresent`
  // answers, so unchecking it afterwards is never fought by this effect.
  const [selectedPacks, setSelectedPacks] = useState<Set<ChartPackKey>>(() => new Set(['core']))
  const [railsChecked, setRailsChecked] = useState(false)
  useEffect(() => {
    if (railsChecked || !paymentRailsPresent.data) return
    setRailsChecked(true)
    setSelectedPacks((prev) => {
      const next = new Set(prev)
      for (const key of defaultSelectedPacks(paymentRailsPresent.data)) next.add(key)
      return next
    })
  }, [railsChecked, paymentRailsPresent.data])

  function togglePack(key: ChartPackKey, checked: boolean) {
    setSelectedPacks((prev) => {
      const next = new Set(prev)
      if (checked) next.add(key)
      else next.delete(key)
      return next
    })
  }

  const provisionChart = api.ledger.provisionChart.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.ledger.chartAccounts.invalidate(),
        utils.ledger.roleMap.invalidate(),
      ])
    },
    onError: (error) => {
      toastError({ title: 'Error creating the chart', description: error.message })
    },
  })

  async function handleImported() {
    await Promise.all([utils.ledger.chartAccounts.invalidate(), utils.ledger.roleMap.invalidate()])
  }

  const rows = [...(roleMap.data ?? [])].sort(
    (a, b) =>
      STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
      (ACCOUNT_ROLE_LABELS[a.role as AccountRole] ?? a.role).localeCompare(
        ACCOUNT_ROLE_LABELS[b.role as AccountRole] ?? b.role
      )
  )

  const required = rows.filter((row) => row.state !== 'unused')
  const confirmed = required.filter((row) => row.state === 'confirmed').length
  const outstanding = required.filter((row) => row.state !== 'confirmed')

  // 🛑 Gate on the QUERY, never on an empty array. An org whose chart has not
  // loaded yet and an org that genuinely has no chart are different answers, and
  // offering "create the default chart" to the first one is an offer to duplicate
  // a chart that already exists.
  const chartIsEmpty = !chart.isPending && !chart.isError && (chart.data?.length ?? 0) === 0

  if (chartIsEmpty) {
    const forced = forcedPacks(selectedPacks)
    const packsToSubmit = resolveSelectedPacks(selectedPacks)

    return (
      <div className='flex flex-col gap-4 p-4'>
        <p className='text-muted-foreground text-sm'>
          Every line of a journal entry names an account by role, and each role has to point at a
          real account in your chart. This organization has no chart yet.
        </p>

        <div className='flex flex-col gap-4 sm:flex-row'>
          <div className='flex-1'>
            <ImportChartButton
              mode='wizard'
              connected={provider.connected}
              chartIsEmpty
              onImported={() => void handleImported()}
            />
          </div>

          <div className='flex flex-1 flex-col gap-2 rounded-xl border p-3'>
            <p className='font-medium text-sm'>Create the default chart of accounts</p>
            <p className='text-muted-foreground text-xs'>
              A starting template, not a standard - rename, renumber and add your own afterwards,
              and nothing here is overwritten if you run this again.
            </p>

            <div className='flex flex-col gap-1'>
              {CHART_PACK_KEYS.map((key) => {
                const pack = CHART_PACKS[key]
                const isCore = key === 'core'
                const checked = isCore || selectedPacks.has(key) || forced.has(key)
                const disabled = isCore || forced.has(key)
                return (
                  <label
                    key={key}
                    className='flex items-start gap-2 rounded-md p-1 hover:bg-muted/50'>
                    <Checkbox
                      className='mt-0.5'
                      checked={checked}
                      disabled={disabled}
                      onCheckedChange={(value) => togglePack(key, value === true)}
                    />
                    <span className='flex min-w-0 flex-col'>
                      <span className='text-sm'>
                        {pack.label}{' '}
                        <span className='text-muted-foreground text-xs'>
                          · {pack.accounts.length} accounts
                        </span>
                      </span>
                      <span className='text-muted-foreground text-xs'>{pack.description}</span>
                    </span>
                  </label>
                )
              })}
            </div>

            <div>
              <Button
                variant='outline'
                size='sm'
                loading={provisionChart.isPending}
                loadingText='Creating...'
                onClick={() => provisionChart.mutate({ packs: packsToSubmit })}>
                Create the default chart
              </Button>
            </div>
          </div>
        </div>

        <p className='text-muted-foreground text-xs'>
          Prefer to build your own? Add accounts on{' '}
          <Link href={CHART_HREF} className='underline'>
            the chart of accounts
          </Link>
          , then come back and map each role.
        </p>
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-4 p-4'>
      <p className='text-muted-foreground text-sm'>
        Every line of a journal entry names an account by role, and each role has to point at a real
        account in your chart. Nothing can be previewed until they do.
      </p>

      {roleMap.isPending || chart.isPending ? (
        <EmptySection loading />
      ) : roleMap.isError ? (
        <Alert variant='destructive'>
          <AlertTitle>Could not read the account map</AlertTitle>
          <AlertDescription>{roleMap.error.message}</AlertDescription>
        </Alert>
      ) : (
        <>
          <div className='flex flex-wrap items-center gap-2'>
            <span className='font-medium text-foreground text-sm'>
              {confirmed} of {required.length} roles confirmed
            </span>
            {outstanding.length > 0 && (
              <span className='text-muted-foreground text-sm'>
                {outstanding.length} still need{outstanding.length === 1 ? 's' : ''} a look
              </span>
            )}
          </div>

          <div className='overflow-hidden rounded-xl border'>
            <ul className='flex flex-col'>
              {rows.map((row) => (
                <li
                  key={row.role}
                  className='flex items-center justify-between gap-2 border-b px-3 py-1.5 text-sm last:border-b-0'>
                  <span className='min-w-0 flex-1 truncate'>
                    {ACCOUNT_ROLE_LABELS[row.role as AccountRole] ?? row.role}
                  </span>
                  <span className='hidden min-w-0 flex-1 sm:block'>
                    <AccountLabel
                      account={row.account}
                      density='compact'
                      fallback='-'
                      className='text-muted-foreground'
                    />
                  </span>
                  <Badge variant={STATE_BADGE[row.state].variant} size='sm' className='shrink-0'>
                    {STATE_BADGE[row.state].label}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      <p className='text-muted-foreground text-xs'>
        A suggested account is a guess from the account number and name. Confirm it so a later
        renumber cannot quietly move where a role posts.
      </p>

      <div>
        <Button variant='outline' size='sm' asChild>
          <Link href={ROLES_HREF}>
            Open the account map
            <ArrowUpRight />
          </Link>
        </Button>
      </div>
    </div>
  )
}
