// apps/web/src/components/accounting/ui/settings/opening-settings-page.tsx
'use client'

// Accounting > Settings > Opening balances (plans/accounting/ui-plan.md §2.2).
//
// The wizard's page 3b, in shape A: `SettingsPage` > one wide `SettingsSection`
// > the grid > `FormSaveBar`. The wizard is where an org fills this in once;
// this is where it comes back to look at it, and - while nothing has posted -
// to correct it.
//
// 🛑 The three inventory rows keep their auxx / QuickBooks / Difference
// columns. That comparison is inventory-specific by design: the provider
// snapshot exists to catch a cutover problem before it falls into the first
// month's balancing plug, and there is no provider figure to compare the other
// thirty accounts against. So they sit in their own panel above the grid, and
// appear in the grid as locked rows carrying the auxx number.
//
// 🛑 Integer minor units are validated BEFORE saving. `CURRENCY` does not
// enforce them: `normalizeSettingValue` routes the value through
// `fieldValueSchemas.number`, which accepts `12.5`. `readOpeningBaseline`
// refuses a fractional value on the read side, so with no write-side check the
// failure mode is a setup that saves and then cannot close.
//
// 🛑 After finalize the whole page is read-only and the remedy is named rather
// than implied: a posted opening balance is corrected by REVERSING the entry
// from the ledger and posting a new one. `useAccountingSettingsFreeze` is the
// browser half; `assertAccountingSetupUnfrozen` on the server is what actually
// refuses, on both the settings write and `ledgerOpening.save`.

import { FeatureKey, PermissionKey } from '@auxx/lib/permissions/client'
import type { OpeningTrialBalanceRow } from '@auxx/lib/postings/client'
import {
  ACCOUNT_ROLES,
  openingDifference,
  openingDifferenceRows,
  readSettingMinorUnits,
  summariseOpeningTrialBalance,
} from '@auxx/lib/postings/client'
import type { SettingValue } from '@auxx/lib/settings/client'
import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { ExternalLink, Lock, Scale } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { FormSaveBar } from '~/components/global/forms/form-save-bar'
import SettingsPage, { SettingsSection } from '~/components/global/settings-page'
import { SettingsFieldRow } from '~/components/settings/settings-field-row'
import { useRequireCapability } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'
import {
  FREEZE_REASON,
  useAccountingSettingsFreeze,
} from '../../hooks/use-accounting-settings-freeze'
import { useAccountingSetupDraft } from '../../hooks/use-accounting-setup-draft'
import {
  ACCOUNTING_KEYS,
  everyMinorUnitValid,
  minorUnitError,
  OPENING_DRAFT_KEYS,
  OPENING_PAIRS,
  readMinorUnits,
} from './accounting-settings-keys'
import { OpeningPairField, OpeningTotalRow } from './opening-reconciliation-panel'
import {
  applyOpeningCellChange,
  OpeningTbGrid,
  openingRowsDifferFromServer,
  openingVerdict,
  overlayInventorySettings,
} from './opening-tb-grid'

/** The six inventory balances, without the journal reference. Only these are money. */
const BALANCE_KEYS = OPENING_DRAFT_KEYS.filter(
  (key) => key !== ACCOUNTING_KEYS.qboOpeningJournalRef
)

const BREADCRUMBS = [
  { title: 'Accounting', href: '/app/accounting' },
  { title: 'Settings' },
  { title: 'Opening balances' },
]

const PAGE_DESCRIPTION =
  'What every account was worth on the cutover date, and the arithmetic that has to agree before anything posts.'

/** Why the three inventory rows cannot be typed into in the grid. */
const GRID_LOCK_REASON =
  'Set in the cutover snapshot above. This is the inventory figure the first month-end close ' +
  'measures its delta from, so it has one authority.'

export function AccountingOpeningSettingsPage() {
  useRequireCapability(PermissionKey.ledgerView)
  const { hasAccess } = useFeatureFlags()
  const { frozen } = useAccountingSettingsFreeze()
  const { draft, patch, dirty, save, discard, controlled, isSaving } =
    useAccountingSetupDraft(OPENING_DRAFT_KEYS)

  const utils = api.useUtils()
  const opening = api.ledgerOpening.get.useQuery()
  const saveTrialBalance = api.ledgerOpening.save.useMutation({
    onSuccess: () => utils.ledgerOpening.get.invalidate(),
    onError: (error) =>
      toastError({ title: 'The opening trial balance was not saved', description: error.message }),
  })

  // `edited` holds ONLY what somebody typed into the grid; the locked inventory
  // rows are overlaid at render time, below. Keeping the overlay out of state is
  // what stops a change to the panel above from having to reseed - and therefore
  // discard - grid edits that are not saved yet.
  const [edited, setEdited] = useState<OpeningTrialBalanceRow[] | null>(null)
  const [gridDirty, setGridDirty] = useState(false)
  const serverRows = opening.data?.rows

  // A fresh answer from the server supersedes whatever was typed against the old
  // one. `serverRows` is the TRIGGER, not a value the body reads - dropping it
  // would make this a mount-only reset that never fires again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: serverRows is the trigger, not a read value
  useEffect(() => {
    setEdited(null)
    setGridDirty(false)
  }, [serverRows])

  // 🛑 The three locked rows track the DRAFT of the panel above, not the saved
  // settings the server read. This is one page: somebody who types a new
  // finished-goods figure has to see the trial balance move with it, or the
  // verdict under the grid is answering a question about the old number.
  const rawMaterialsMinor = readSettingMinorUnits(draft[ACCOUNTING_KEYS.openingRawMaterials])
  const wipMinor = readSettingMinorUnits(draft[ACCOUNTING_KEYS.openingWip])
  const finishedGoodsMinor = readSettingMinorUnits(draft[ACCOUNTING_KEYS.openingFinishedGoods])

  const rows = useMemo(
    () =>
      overlayInventorySettings(edited ?? serverRows ?? [], {
        [ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS]: rawMaterialsMinor,
        [ACCOUNT_ROLES.INVENTORY_WIP]: wipMinor,
        [ACCOUNT_ROLES.INVENTORY_FINISHED_GOODS]: finishedGoodsMinor,
      }),
    [edited, serverRows, rawMaterialsMinor, wipMinor, finishedGoodsMinor]
  )

  // The differences are computed over the DRAFT, not the saved record, so the
  // verdict tracks what is on screen. Both helpers are the shared lib
  // arithmetic the readiness predicate and the checklist widget use.
  const differenceRows = openingDifferenceRows(draft)
  const total = openingDifference(draft)
  const incomplete = BALANCE_KEYS.some((key) => readMinorUnits(draft[key]) === null)
  const valid = everyMinorUnitValid(draft, BALANCE_KEYS)
  const rowByRole = new Map(differenceRows.map((row) => [row.role, row]))

  // 🛑 Dirty is "what is on screen differs from what the server holds", not
  // "somebody typed in a cell". The three locked rows are overlaid at render
  // time from the panel above, so a changed inventory figure moves the grid
  // without touching `gridDirty` - and the entry posts from the STORED draft,
  // which would still hold the old number. See `openingRowsDifferFromServer`.
  const overlayDirty = useMemo(
    () => openingRowsDifferFromServer(rows, serverRows),
    [rows, serverRows]
  )

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
  // The server's own answer, and the browser hook's, are the same predicate on
  // two sides of the wire. Either one saying frozen locks the page.
  const readOnly = frozen || (opening.data?.frozen ?? false)

  function patchKey(key: string, value: number | null) {
    patch({ [key]: value as SettingValue })
  }

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
          title='Cutover snapshot'
          description={
            opening.data?.cutoverDate
              ? `What every account held at the close of ${opening.data.cutoverDate}. Amounts are whole cents.`
              : 'What every account held at the cutoff. Amounts are whole cents.'
          }>
          {/* ── The three inventory accounts, reconciled against the provider ── */}
          <FieldPanel className='mt-1 p-0' resizeId='accounting-opening' defaultLabelWidth={220}>
            {OPENING_PAIRS.map((pair, index) => {
              const row = rowByRole.get(pair.role)
              return (
                <SettingsFieldRow
                  key={pair.role}
                  settingKey={pair.auxxKey}
                  title={`${pair.accountCode} ${pair.label}`}>
                  <OpeningPairField
                    auxx={row?.auxx ?? null}
                    qbo={row?.qbo ?? null}
                    onAuxxChange={(value) => patchKey(pair.auxxKey, value)}
                    onQboChange={(value) => patchKey(pair.qboKey, value)}
                    auxxError={minorUnitError(draft[pair.auxxKey])}
                    qboError={minorUnitError(draft[pair.qboKey])}
                    showLabels={index === 0}
                    readOnly={readOnly}
                    readOnlyReason={FREEZE_REASON}
                  />
                </SettingsFieldRow>
              )
            })}

            <FieldPanelRow
              title='Reconciliation'
              description='The two snapshots must agree before setup can be finalized.'>
              <OpeningTotalRow total={total} incomplete={incomplete} />
            </FieldPanelRow>

            <SettingsFieldRow
              settingKey={ACCOUNTING_KEYS.qboOpeningJournalRef}
              title='QuickBooks journal reference'
              placeholder='For example JE-1042'
              {...controlled(ACCOUNTING_KEYS.qboOpeningJournalRef)}
            />
          </FieldPanel>

          <p className='text-muted-foreground text-xs'>
            The QuickBooks figures are provenance. The books are valued from the auxx snapshot once
            the two agree, and the opening entry it booked in QuickBooks is not ours, which is why
            the link here is a reference string rather than an auxx posting.
          </p>

          {/* ── The whole chart ────────────────────────────────────────────── */}
          <div className='mt-6 flex flex-col gap-2'>
            <div className='flex flex-wrap items-baseline justify-between gap-2'>
              <span className='font-medium text-foreground text-sm'>Opening trial balance</span>
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
            </div>

            <p className='text-muted-foreground text-sm'>
              Use the 12/31 statement balance for every bank and card account. Do not use the tax
              return.
            </p>

            {opening.isPending ? (
              <Skeleton className='h-64 w-full' />
            ) : (
              <OpeningTbGrid
                rows={rows}
                currency={currency}
                readOnly={readOnly}
                lockReason={GRID_LOCK_REASON}
                onCellChange={(accountCode, column, minor) => {
                  setEdited((prev) =>
                    applyOpeningCellChange(prev ?? serverRows ?? [], accountCode, column, minor)
                  )
                  setGridDirty(true)
                }}
                verdict={openingVerdict(
                  summary.debitMinor,
                  summary.creditMinor,
                  summary.rows,
                  currency
                )}
              />
            )}

            {readOnly ? (
              <p className='text-muted-foreground text-xs'>
                To change a posted opening balance, reverse the entry from the ledger and post a new
                one. The ledger has no update path, and editing this behind a posted entry would
                leave two documents claiming to be the same one.
              </p>
            ) : (
              <div className='flex justify-end'>
                <Button
                  variant='outline'
                  size='sm'
                  disabled={!gridDirty && !overlayDirty}
                  loading={saveTrialBalance.isPending}
                  loadingText='Saving...'
                  onClick={() =>
                    saveTrialBalance.mutate({
                      lines: rows.flatMap((row) => [
                        ...(row.debitMinor
                          ? [
                              {
                                accountCode: row.accountCode,
                                direction: 'debit' as const,
                                amountMinor: row.debitMinor,
                              },
                            ]
                          : []),
                        ...(row.creditMinor
                          ? [
                              {
                                accountCode: row.accountCode,
                                direction: 'credit' as const,
                                amountMinor: row.creditMinor,
                              },
                            ]
                          : []),
                      ]),
                    })
                  }>
                  Save trial balance
                </Button>
              </div>
            )}
          </div>
        </SettingsSection>

        {/*
          Two save controls, and they are not redundant. The bar below writes
          SETTINGS through the catalog's batch mutation; the button above writes
          the `journal_entry` record the trial balance lives on. One bar over
          both would have to pretend two different mutations are one save, and
          the failure of either would be reported against the other.
        */}
        <FormSaveBar
          dirty={dirty}
          isSaving={isSaving}
          onSave={save}
          onDiscard={discard}
          saveDisabled={!valid}
          label={
            valid ? 'Unsaved changes' : 'Amounts must be whole cents before this can be saved.'
          }
        />
      </div>
    </SettingsPage>
  )
}
