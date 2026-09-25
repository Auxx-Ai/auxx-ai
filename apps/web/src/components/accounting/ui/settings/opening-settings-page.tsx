// apps/web/src/components/accounting/ui/settings/opening-settings-page.tsx
'use client'
// Accounting > Settings > Opening balances: the opening entry as a grid over the
// whole chart, inventory included (plans/accounting/tasks/103 §5a). Read-only once
// the ledger holds an entry; the server's `assertAccountingSetupUnfrozen` refuses.

import {
  OPENING_FROM_NOTHING_SETTING_KEY,
  summariseOpeningTrialBalance,
} from '@auxx/lib/accounting/ledger/client'
import type { OpeningTrialBalanceRow } from '@auxx/lib/accounting/opening/client'
import { FeatureKey, PermissionKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { Boxes, ExternalLink, Lock, Scale } from 'lucide-react'
import Link from 'next/link'
import { useQueryState } from 'nuqs'
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import SettingsPage, { SettingsSection } from '~/components/global/settings-page'
import { useSettings } from '~/hooks/use-settings'
import { useRequireCapability } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'
import { useAccountingSettingsFreeze } from '../../hooks/use-accounting-settings-freeze'
import { OpeningInventoryDifference } from '../setup-wizard/opening-inventory-difference'
import { OpeningFillButton } from './opening-fill-button'
import {
  applyOpeningCellChange,
  OpeningTbGrid,
  openingEvidenceInstruction,
  openingVerdict,
} from './opening-tb-grid'

const BREADCRUMBS = [
  { title: 'Accounting', href: '/app/accounting' },
  { title: 'Settings' },
  { title: 'Opening balances' },
]

const PAGE_DESCRIPTION =
  'What every account was worth on the cutover date, inventory included, as one balanced entry.'

export function AccountingOpeningSettingsPage() {
  // `ledgerControl`: `ledgerOpening.save` and `.fillFromProvider` are gated on it.
  useRequireCapability(PermissionKey.ledgerControl)
  const { hasAccess } = useFeatureFlags()
  const { frozen } = useAccountingSettingsFreeze()
  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const fromNothing = getSetting(OPENING_FROM_NOTHING_SETTING_KEY) === true
  const openingSource = fromNothing
    ? 'none'
    : getSetting('accounting.openingSource') === 'provider'
      ? 'provider'
      : 'manual'

  const utils = api.useUtils()
  const opening = api.ledgerOpening.get.useQuery()
  const saveTrialBalance = api.ledgerOpening.save.useMutation({
    onSuccess: () => utils.ledgerOpening.get.invalidate(),
    onError: (error) =>
      toastError({ title: 'The opening balances were not saved', description: error.message }),
  })

  // `?s=inventory` is what the close blocker and the Set counts result link to.
  const [section] = useQueryState('s')
  const inventoryRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (section === 'inventory') inventoryRef.current?.scrollIntoView({ block: 'start' })
  }, [section])

  // `edited` holds only what somebody typed; a fresh server answer supersedes it.
  const [edited, setEdited] = useState<OpeningTrialBalanceRow[] | null>(null)
  const serverRows = opening.data?.rows
  // biome-ignore lint/correctness/useExhaustiveDependencies: serverRows is the trigger, not a read value
  useEffect(() => {
    setEdited(null)
  }, [serverRows])

  const rows = edited ?? serverRows ?? []
  const summary = useMemo(
    () =>
      summariseOpeningTrialBalance(
        rows.flatMap((row) => [
          ...(row.debitMinor ? [{ direction: 'debit' as const, amountMinor: row.debitMinor }] : []),
          ...(row.creditMinor
            ? [{ direction: 'credit' as const, amountMinor: row.creditMinor }]
            : []),
        ])
      ),
    [rows]
  )

  const currency = opening.data?.currency ?? 'USD'
  const posting = opening.data?.posting ?? null
  const readOnly = frozen || (opening.data?.frozen ?? false)

  if (!hasAccess(FeatureKey.accounting)) {
    return (
      <SettingsPage
        title='Opening balances'
        description={PAGE_DESCRIPTION}
        breadcrumbs={BREADCRUMBS}>
        <EmptyState
          icon={Lock}
          title='Accounting Not Available'
          description='Upgrade your plan to keep books in Auxx.'
          button={<div className='h-12' />}
        />
      </SettingsPage>
    )
  }

  return (
    <SettingsPage title='Opening balances' description={PAGE_DESCRIPTION} breadcrumbs={BREADCRUMBS}>
      <div className='flex flex-1 flex-col gap-8 p-3 sm:p-6'>
        <SettingsSection
          icon={Scale}
          title='Opening trial balance'
          description={
            opening.data?.cutoverDate
              ? `What every account held at the close of ${opening.data.cutoverDate}. Amounts are whole cents.`
              : 'What every account held at the cutoff. Amounts are whole cents.'
          }>
          <div className='flex flex-col gap-2'>
            <div className='flex flex-wrap items-center justify-end gap-3'>
              {posting && (
                <span className='flex items-center gap-2 text-muted-foreground text-xs'>
                  Posted as
                  <Link
                    href={`/app/accounting?posting=${posting.id}`}
                    className='inline-flex items-center gap-1 font-mono text-primary-600 hover:underline'>
                    {posting.docNumber}
                    <ExternalLink className='size-3' />
                  </Link>
                </span>
              )}
              <OpeningFillButton
                frozen={readOnly}
                cutoverDate={opening.data?.cutoverDate ?? null}
                onFilled={() => setEdited(null)}
              />
            </div>

            <p className='text-muted-foreground text-sm'>
              {opening.data?.cutoverDate
                ? openingEvidenceInstruction(openingSource, opening.data.cutoverDate)
                : 'Use the statement balance for every bank and card account. Do not use the tax return.'}
            </p>

            {opening.isPending ? (
              <Skeleton className='h-64 w-full' />
            ) : (
              // The grid's sticky header pins under `SettingsPage`'s own sticky block.
              <div
                style={
                  {
                    '--statement-sticky-top': 'var(--settings-sticky-top, 0px)',
                  } as CSSProperties
                }>
                <OpeningTbGrid
                  rows={rows}
                  currency={currency}
                  readOnly={readOnly}
                  onCellChange={(accountId, column, minor) =>
                    setEdited((prev) =>
                      applyOpeningCellChange(prev ?? serverRows ?? [], accountId, column, minor)
                    )
                  }
                  verdict={openingVerdict(
                    summary.debitMinor,
                    summary.creditMinor,
                    summary.rows,
                    currency,
                    fromNothing
                  )}
                />
              </div>
            )}

            {readOnly ? (
              <p className='text-muted-foreground text-xs'>
                To change a posted opening balance, reverse the entry from the ledger and post a new
                one. The ledger has no update path.
              </p>
            ) : (
              <div className='flex justify-end'>
                <Button
                  variant='outline'
                  size='sm'
                  disabled={edited === null}
                  loading={saveTrialBalance.isPending}
                  loadingText='Saving...'
                  onClick={() =>
                    saveTrialBalance.mutate({
                      lines: rows.flatMap((row) => [
                        ...(row.debitMinor
                          ? [
                              {
                                glAccountId: row.accountId,
                                direction: 'debit' as const,
                                amountMinor: row.debitMinor,
                              },
                            ]
                          : []),
                        ...(row.creditMinor
                          ? [
                              {
                                glAccountId: row.accountId,
                                direction: 'credit' as const,
                                amountMinor: row.creditMinor,
                              },
                            ]
                          : []),
                      ]),
                    })
                  }>
                  Save opening balances
                </Button>
              </div>
            )}
          </div>
        </SettingsSection>

        <div ref={inventoryRef} className='scroll-mt-[var(--settings-sticky-top,0px)]'>
          <SettingsSection
            icon={Boxes}
            title='Opening inventory'
            description='The books against your counted parts at the cutover. Never posted on its own: each press posts the difference since the last one.'>
            <OpeningInventoryDifference />
          </SettingsSection>
        </div>
      </div>
    </SettingsPage>
  )
}
