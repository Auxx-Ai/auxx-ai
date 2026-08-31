// apps/web/src/components/accounting/ui/settings/opening-settings-page.tsx
'use client'

// Accounting > Settings > Opening balances (13-accounting-ui.md §5.4).
//
// Shape A with ONE wide section: the two snapshots side by side, the difference
// per account and in total, and the provider journal reference that says where
// the other side came from.
//
// 🛑 Draft keys are scoped to `OPENING_DRAFT_KEYS` through
// `useAccountingSetupDraft`, the same hook the setup wizard narrows its writes
// with. `useSettings({ scope: 'GENERAL' })` returns every `GENERAL`-scope
// setting in the app, so an unscoped save would clobber unrelated keys.
//
// 🛑 Integer minor units are validated BEFORE saving. `CURRENCY` does not
// enforce them: `normalizeSettingValue` routes the value through
// `fieldValueSchemas.number`, which accepts `12.5`. `readOpeningBaseline`
// refuses a fractional value on the read side, so with no write-side check the
// failure mode is a setup that saves and then cannot close.

import { FeatureKey, PermissionKey } from '@auxx/lib/permissions/client'
import { openingDifference, openingDifferenceRows } from '@auxx/lib/postings/client'
import type { SettingValue } from '@auxx/lib/settings/client'
import { Lock, Scale } from 'lucide-react'
import { EmptyState } from '~/components/global/empty-state'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { FormSaveBar } from '~/components/global/forms/form-save-bar'
import SettingsPage, { SettingsSection } from '~/components/global/settings-page'
import { SettingsFieldRow } from '~/components/settings/settings-field-row'
import { useRequireCapability } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
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

/** The six balances, without the journal reference. Only these are money. */
const BALANCE_KEYS = OPENING_DRAFT_KEYS.filter(
  (key) => key !== ACCOUNTING_KEYS.qboOpeningJournalRef
)

const BREADCRUMBS = [
  { title: 'Accounting', href: '/app/accounting' },
  { title: 'Settings' },
  { title: 'Opening balances' },
]

const PAGE_DESCRIPTION =
  'The frozen cutover snapshot, on both sides, and the arithmetic that has to agree before anything posts.'

export function AccountingOpeningSettingsPage() {
  useRequireCapability(PermissionKey.ledgerView)
  const { hasAccess } = useFeatureFlags()
  const { frozen } = useAccountingSettingsFreeze()
  const { draft, patch, dirty, save, discard, controlled, isSaving } =
    useAccountingSetupDraft(OPENING_DRAFT_KEYS)

  // The difference is computed over the DRAFT, not the saved record, so the
  // verdict tracks what is on screen. Both helpers are the shared lib arithmetic
  // the readiness predicate and the checklist widget use.
  const differenceRows = openingDifferenceRows(draft)
  const total = openingDifference(draft)
  const incomplete = BALANCE_KEYS.some((key) => readMinorUnits(draft[key]) === null)
  const valid = everyMinorUnitValid(draft, BALANCE_KEYS)

  const rowByRole = new Map(differenceRows.map((row) => [row.role, row]))

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
          description='What each inventory account held at the cutoff, from the physical count on one side and from QuickBooks on the other. Amounts are whole cents.'>
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
                    readOnly={frozen}
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
            the two agree, and the opening entry itself was booked in QuickBooks, which is why the
            link here is a reference string rather than an auxx posting.
          </p>
        </SettingsSection>

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
