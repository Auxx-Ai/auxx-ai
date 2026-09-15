// apps/web/src/components/accounting/ui/settings/general-settings-page.tsx
'use client'

// Accounting > Settings > General (13-accounting-ui.md §5.4).
//
// Shape A, the sectioned form page: `SettingsPage` + two independently flowing
// columns of `SettingsSection`s, `FieldPanel` + `SettingsFieldRow`, and a `useDirtyDraft`
// slice PER SECTION.
//
// 🛑 Draft keys are scoped explicitly. `useSettings({ scope: 'GENERAL' })`
// returns EVERY `GENERAL`-scope setting in the whole app and every
// `accounting.*` key is `GENERAL`, so an unscoped save here would clobber
// unrelated settings. Each section takes its own key array from
// `accounting-settings-keys.ts` through `useAccountingSetupDraft`, the same
// hook the setup wizard narrows its writes with.
//
// The fulfillment posting mode and the "Where payments land" routes used to
// be here. Brief 28 §3 moved them to Settings > Posting (decision 1: replace,
// not duplicate), which renders every posting-type setting off `POSTING_POLICY`.
// This page keeps what its nav description claims: period, setup status and
// standard cost.

import { FieldType } from '@auxx/database/enums'
import { FeatureKey, PermissionKey } from '@auxx/lib/permissions/client'
import { isValidTimeZone, resolveSetupReadiness } from '@auxx/lib/postings/client'
import type { SettingValue } from '@auxx/lib/settings/client'
import { Badge } from '@auxx/ui/components/badge'
import { CalendarRange, ExternalLink, Lock, Scale } from 'lucide-react'
import Link from 'next/link'
import { useMemo } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { EmptyState } from '~/components/global/empty-state'
import { FieldPanel } from '~/components/global/forms/field-panel'
import { FormSaveBar } from '~/components/global/forms/form-save-bar'
import SettingsPage, { SettingsSection } from '~/components/global/settings-page'
import { TimeZonePicker } from '~/components/pickers/timezone-picker'
import { SettingsFieldRow } from '~/components/settings/settings-field-row'
import { useSettings } from '~/hooks/use-settings'
import { useUser } from '~/hooks/use-user'
import { useRequireCapability } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { useAccountingProviderStatus } from '../../hooks/use-accounting-provider-status'
import {
  FREEZE_REASON,
  useAccountingSettingsFreeze,
} from '../../hooks/use-accounting-settings-freeze'
import { useAccountingSetupDraft } from '../../hooks/use-accounting-setup-draft'
import {
  ABSORPTION_DRAFT_KEYS,
  ACCOUNTING_KEYS,
  buildReadinessRecord,
  everyMinorUnitValid,
  minorUnitError,
  PERIOD_DRAFT_KEYS,
  readMinorUnits,
  readText,
} from './accounting-settings-keys'
import { FrozenLock } from './frozen-lock'
import { SetupStatusSection } from './setup-status-section'

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/

const BREADCRUMBS = [
  { title: 'Accounting', href: '/app/accounting' },
  { title: 'Settings' },
  { title: 'General' },
]

const PAGE_DESCRIPTION =
  'The period the books are kept in, how setup is finalized, and what a build absorbs.'

export function AccountingGeneralSettingsPage() {
  useRequireCapability(PermissionKey.ledgerView)
  const { hasAccess } = useFeatureFlags()
  const { userId } = useUser()
  const { getSetting, batchUpdateOrganizationSettings, isBatchUpdatingOrgSettings } = useSettings({
    scope: 'GENERAL',
  })
  const { frozen } = useAccountingSettingsFreeze()

  // The shared predicate, over the settings record. No query.
  //
  // ⚠️ This is the SECOND Finalize door (see `wizard-done-page`), so it has to
  // answer `providerConnected` the same way the wizard does or the two doors
  // disagree about the same org. A load reads as connected for the reason given
  // there: erring toward one requirement briefly unmet beats enabling Finalize
  // against a baseline nobody reconciled (brief 22 §2.5).
  const providerStatus = useAccountingProviderStatus()
  const providerConnected = providerStatus.loading || providerStatus.connected
  const readiness = useMemo(
    () => resolveSetupReadiness(buildReadinessRecord(getSetting), { providerConnected }),
    [getSetting, providerConnected]
  )

  // ── Section 1: accounting period ─────────────────────────────────────────
  // A SEPARATE draft slice per section: the two validate independently, and the
  // rates could later save through a different mutation than the period does.
  const period = useAccountingSetupDraft(PERIOD_DRAFT_KEYS)
  const { draft: periodDraft, patch: patchPeriod } = period

  const cutoff = readText(periodDraft[ACCOUNTING_KEYS.cutoffPeriod])
  const bookZone = readText(periodDraft[ACCOUNTING_KEYS.bookTimeZone])
  const cutoffError =
    cutoff && !MONTH_KEY.test(cutoff) ? 'Must be a YYYY-MM month, for example 2026-12.' : undefined
  const zoneError =
    bookZone && !isValidTimeZone(bookZone)
      ? `"${bookZone}" is not a valid IANA timezone.`
      : undefined
  const periodValid = !cutoffError && !zoneError

  // ── Section 2: absorption rates ──────────────────────────────────────────
  const absorption = useAccountingSetupDraft(ABSORPTION_DRAFT_KEYS)
  const { draft: absorptionDraft, patch: patchAbsorption } = absorption

  const absorptionValid = everyMinorUnitValid(absorptionDraft, ABSORPTION_DRAFT_KEYS)

  const dirty = period.dirty || absorption.dirty
  const isSaving = period.isSaving || absorption.isSaving || isBatchUpdatingOrgSettings
  const saveDisabled = (period.dirty && !periodValid) || (absorption.dirty && !absorptionValid)

  function handleFinalize() {
    // The wizard's `done` page writes the same three keys. Both doors, one action.
    batchUpdateOrganizationSettings([
      { key: ACCOUNTING_KEYS.setupState, value: 'finalized' },
      { key: ACCOUNTING_KEYS.setupFinalizedAt, value: new Date().toISOString() },
      { key: ACCOUNTING_KEYS.setupFinalizedByUserId, value: userId ?? null },
    ])
  }

  if (!hasAccess(FeatureKey.accounting)) {
    return (
      <SettingsPage title='General' description={PAGE_DESCRIPTION} breadcrumbs={BREADCRUMBS}>
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
    <SettingsPage title='General' description={PAGE_DESCRIPTION} breadcrumbs={BREADCRUMBS}>
      <div className='flex flex-1 flex-col gap-8 p-3 sm:p-6'>
        {/*
          TWO INDEPENDENT COLUMNS, not a grid of rows.

          Each column is its own flex stack, so a tall section on one side does
          not push the next section down on the other. The original shape was
          three stacked `lg:grid-cols-2` rows, which forces every row to wait for
          its tallest cell: `Setup status` was a tall action panel and
          `Accounting period` is two fields, so the left side grew a large hole
          under it before `Absorption rates` could start.

          🛑 THE SPLIT IS A HEIGHT DECISION, and the old one is gone. It used to
          be "left is what you fill in, right is what the page does or reports" -
          which worked while the right column held the three provider sections.
          Brief 27 moved all three to Settings > Connected system, leaving
          `Setup status` alone in it, so the principle no longer had the material
          to be a principle. Two of the three sections here are draft-backed and
          feed the one save bar below; they are laid out so neither column
          strands, and that is the whole of the rule now.

          ⚠️ `Standard cost` is the one that crossed over, and it is the right
          one to move: it is the longer of the two drafts and `Setup status`
          is the shortest thing on the page, so pairing them balances against
          the period on the left. Do NOT read its position as meaning it is
          not draft-backed - it is, through `absorption`. Brief 28 moved the
          payment routes off the left column to Settings > Posting.

          ⚠️ Nothing may be placed AFTER both columns. Observed 2026-08-28 on
          `abgwpa1l81reht2zmwrcihfu` with the provider section there: it sat alone
          off the bottom of the page and read as missing.

          ⚠️ On mobile the columns stack, so the reading order is
          period -> setup -> absorption. That is the trade for column-major flow.
        */}
        <div className='grid grid-cols-1 items-start gap-8 lg:grid-cols-2'>
          <div className='flex flex-col gap-8'>
            <SettingsSection
              icon={CalendarRange}
              title='Accounting period'
              description='The month the previous system last closed, and the timezone every period key is derived in.'>
              <FieldPanel
                className='mt-1 p-0'
                resizeId='accounting-general-period'
                defaultLabelWidth={220}>
                <SettingsFieldRow settingKey={ACCOUNTING_KEYS.cutoffPeriod} title='Cutoff period'>
                  <MonthTextField
                    value={cutoff}
                    error={cutoffError}
                    readOnly={frozen}
                    readOnlyReason={FREEZE_REASON}
                    onChange={(value) =>
                      patchPeriod({ [ACCOUNTING_KEYS.cutoffPeriod]: value as SettingValue })
                    }
                  />
                </SettingsFieldRow>

                <SettingsFieldRow settingKey={ACCOUNTING_KEYS.bookTimeZone} title='Book timezone'>
                  <BookTimeZoneField
                    value={bookZone}
                    error={zoneError}
                    readOnly={frozen}
                    readOnlyReason={FREEZE_REASON}
                    onChange={(zone) =>
                      patchPeriod({ [ACCOUNTING_KEYS.bookTimeZone]: zone as SettingValue })
                    }
                  />
                </SettingsFieldRow>
              </FieldPanel>

              <p className='text-muted-foreground text-xs'>
                Every entry is dated in this timezone and nothing before the cutoff is kept. What
                posts, when, and the settings that change each type, including where payments land
                and whether fulfillments post automatically, are under{' '}
                <Link
                  href='/app/accounting/settings/posting'
                  className='inline-flex items-center gap-1 text-primary-600 hover:underline'>
                  Posting
                  <ExternalLink className='size-3' />
                </Link>
                .
              </p>
            </SettingsSection>
          </div>

          <div className='flex flex-col gap-8'>
            <SetupStatusSection
              readiness={readiness}
              finalizedAt={readText(getSetting(ACCOUNTING_KEYS.setupFinalizedAt))}
              finalizedByUserId={readText(getSetting(ACCOUNTING_KEYS.setupFinalizedByUserId))}
              hasUnsavedChanges={dirty}
              isFinalizing={isBatchUpdatingOrgSettings}
              onFinalize={handleFinalize}
            />

            <SettingsSection
              icon={Scale}
              title='Standard cost'
              description='Absorption per assembled unit, in whole cents, and how a part first gets a standard. An unset rate absorbs nothing; a zero rate is a real choice.'>
              <FieldPanel
                className='mt-1 p-0'
                resizeId='accounting-general-absorption'
                defaultLabelWidth={220}>
                <SettingsFieldRow
                  settingKey={ACCOUNTING_KEYS.assemblyLaborCostPerUnit}
                  title='Assembly labor'>
                  <AbsorptionRateField
                    value={readMinorUnits(
                      absorptionDraft[ACCOUNTING_KEYS.assemblyLaborCostPerUnit]
                    )}
                    error={minorUnitError(
                      absorptionDraft[ACCOUNTING_KEYS.assemblyLaborCostPerUnit]
                    )}
                    onChange={(value) =>
                      patchAbsorption({
                        [ACCOUNTING_KEYS.assemblyLaborCostPerUnit]: value as SettingValue,
                      })
                    }
                  />
                </SettingsFieldRow>

                <SettingsFieldRow
                  settingKey={ACCOUNTING_KEYS.overheadCostPerUnit}
                  title='Applied overhead'>
                  <AbsorptionRateField
                    value={readMinorUnits(absorptionDraft[ACCOUNTING_KEYS.overheadCostPerUnit])}
                    error={minorUnitError(absorptionDraft[ACCOUNTING_KEYS.overheadCostPerUnit])}
                    onChange={(value) =>
                      patchAbsorption({
                        [ACCOUNTING_KEYS.overheadCostPerUnit]: value as SettingValue,
                      })
                    }
                  />
                </SettingsFieldRow>
                <SettingsFieldRow
                  settingKey={ACCOUNTING_KEYS.autoRollFirstStandard}
                  title='Set a first standard automatically'
                  description='When a part first gets a price, opening stock or a receipt, freeze that as its standard cost.'
                  value={absorptionDraft[ACCOUNTING_KEYS.autoRollFirstStandard] ?? true}
                  onChange={(value) =>
                    patchAbsorption({
                      [ACCOUNTING_KEYS.autoRollFirstStandard]: value as SettingValue,
                    })
                  }
                />
              </FieldPanel>

              <p className='text-muted-foreground text-xs'>
                Conversion cost applies to a subassembly or a finished good only. Applying these
                rates to a purchased component would capitalize labor that was never spent and
                overstate raw materials. Setting a first standard never overwrites one that already
                exists, so a supplier raising a price moves the part&apos;s cost and leaves its
                standard where it is. Re-valuing is what the roll is for, and the roll lives with
                the parts:{' '}
                {/*
                  🛑 The RATES are set here and the ROLL is run there, and that
                  split is deliberate (money 52 §2.2, decision 3). The rates are
                  policy the accountant sets and are draft-backed by the save bar
                  below; the roll asserts edit on the `part` def, so it belongs on
                  a page gated the same way. This sentence is the only thing that
                  connects the two, so it is a link rather than a mention.
                */}
                <Link
                  href='/app/parts/settings/costing'
                  className='inline-flex items-center gap-1 text-primary-600 hover:underline'>
                  Parts, Settings, Costing
                  <ExternalLink className='size-3' />
                </Link>
                .
              </p>
            </SettingsSection>
          </div>
        </div>

        {/*
          One bar covering both drafts. The sections keep SEPARATE `useDirtyDraft`
          slices (they validate independently and could later save through
          different mutations), but two sticky bars would stack on top of each
          other at the viewport bottom, so save/discard fan out to whichever
          slice is actually dirty. Same arrangement as `scheduling-settings-page`.
        */}
        <FormSaveBar
          dirty={dirty}
          isSaving={isSaving}
          onSave={() => {
            // Every slice that counts toward `dirty` must be saved here, or
            // its Save appears, does nothing, and leaves the bar up.
            if (period.dirty) period.save()
            if (absorption.dirty) absorption.save()
          }}
          onDiscard={() => {
            if (period.dirty) period.discard()
            if (absorption.dirty) absorption.discard()
          }}
          saveDisabled={saveDisabled}
        />
      </div>
    </SettingsPage>
  )
}

/**
 * The cutoff month.
 *
 * `TEXT` in the catalog because `FieldOptions` carries no pattern member, so the
 * shape is validated here and again on read, where it fails closed.
 *
 * `disabled` / `className` are declared because `SettingsFieldRow` hands an
 * org-access child to `AdminGate`, which clones it with exactly those two props.
 */
function MonthTextField({
  value,
  error,
  readOnly,
  readOnlyReason,
  onChange,
  disabled,
  className,
}: {
  value: string | null
  error?: string
  readOnly?: boolean
  readOnlyReason?: string
  onChange: (value: string | null) => void
  disabled?: boolean
  className?: string
}) {
  if (readOnly) {
    return (
      <ReadOnlyValue value={value ?? 'Not set'} reason={readOnlyReason} className={className} />
    )
  }
  return (
    <div className={className}>
      <FieldInputAdapter
        fieldType={FieldType.TEXT}
        value={value ?? ''}
        disabled={disabled}
        onChange={(next) => onChange(((next as string) || null) ?? null)}
        placeholder='2026-12'
      />
      {error && <p className='px-2 pb-1 text-destructive text-xs'>{error}</p>}
    </div>
  )
}

/**
 * The book timezone.
 *
 * 🛑 There is NO UTC fallback anywhere in this subsystem, so an unset zone reads
 * as unset rather than defaulting to the browser's or to UTC. A receipt logged
 * at 7pm on January 31 in `America/New_York` is already February 1 in UTC, so a
 * quietly assumed zone posts a month's edge activity into the wrong period.
 */
function BookTimeZoneField({
  value,
  error,
  readOnly,
  readOnlyReason,
  onChange,
  disabled,
  className,
}: {
  value: string | null
  error?: string
  readOnly?: boolean
  readOnlyReason?: string
  onChange: (zone: string) => void
  disabled?: boolean
  className?: string
}) {
  if (readOnly) {
    return (
      <ReadOnlyValue value={value ?? 'Not set'} reason={readOnlyReason} className={className} />
    )
  }
  return (
    <div className={className}>
      <TimeZonePicker
        selected={value ?? undefined}
        onChange={onChange}
        disabled={disabled}
        placeholder='Not set'
        triggerProps={{ variant: 'transparent', className: 'w-full ps-0 pe-1' }}
      />
      {!value && (
        <p className='px-2 pb-1 text-muted-foreground text-xs'>
          Unset refuses to post rather than assuming UTC.
        </p>
      )}
      {error && <p className='px-2 pb-1 text-destructive text-xs'>{error}</p>}
    </div>
  )
}

/**
 * An absorption rate.
 *
 * ⚠️ `null` and `0` MUST read differently. An unset rate absorbs nothing while
 * looking like it worked; a zero rate is a business decision somebody made.
 * `loadAbsorptionRates` returns `null` for unset and must keep doing so, so the
 * screen has to be able to show the difference.
 */
function AbsorptionRateField({
  value,
  error,
  onChange,
  disabled,
  className,
}: {
  value: number | null
  error?: string
  onChange: (value: number | null) => void
  disabled?: boolean
  className?: string
}) {
  return (
    <div className={className}>
      <div className='flex flex-1 items-center gap-2'>
        <FieldInputAdapter
          fieldType={FieldType.CURRENCY}
          value={value}
          disabled={disabled}
          onChange={(next) => onChange((next as number | undefined) ?? null)}
          placeholder='Not set'
        />
        {value === null ? (
          <Badge variant='amber' size='xs' className='shrink-0 whitespace-nowrap'>
            Not set
          </Badge>
        ) : value === 0 ? (
          <Badge variant='outline' size='xs' className='shrink-0 whitespace-nowrap'>
            Zero
          </Badge>
        ) : null}
      </div>
      <p className='px-2 pb-1 text-muted-foreground text-xs'>
        {value === null
          ? 'Unset. Nothing is absorbed, and no build carries this cost.'
          : value === 0
            ? 'Zero, deliberately. Nothing is absorbed, but the rate is configured.'
            : 'Absorbed into every assembled unit.'}
      </p>
      {error && <p className='px-2 pb-1 text-destructive text-xs'>{error}</p>}
    </div>
  )
}

/** A frozen field: the value, plus why it can no longer be edited. */
function ReadOnlyValue({
  value,
  reason,
  className,
}: {
  value: string
  reason?: string
  className?: string
}) {
  return (
    <div className={className}>
      {/*
        The value on the left, the lock on the right, and the reason in the
        lock's tooltip. It used to be a `Locked` badge beside the value plus the
        whole reason as body text underneath, which made a settled state read
        like a warning and pushed the two rows out of line with every other row
        on the page.
      */}
      <div className='flex min-h-8 items-center gap-2 px-2 py-1.5 text-sm'>
        <span className='min-w-0 flex-1 truncate'>{value}</span>
        {reason && <FrozenLock reason={reason} />}
      </div>
    </div>
  )
}

/** Exported so the wizard's period page can validate the same month shape. */
export { MONTH_KEY }
