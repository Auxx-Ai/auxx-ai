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

import { FieldType } from '@auxx/database/enums'
// The route table is owned by the module that READS it (`resolvePaymentRoute`),
// so the five keys and their labels are imported rather than restated here - a
// second copy would let this form offer a destination the resolver falls back
// out of, silently.
import { PAYMENT_ROUTE_SETTING_KEYS } from '@auxx/lib/money/client'
import { FeatureKey, PermissionKey } from '@auxx/lib/permissions/client'
import { isValidTimeZone, resolveSetupReadiness } from '@auxx/lib/postings/client'
import type { SettingValue } from '@auxx/lib/settings/client'
import { Badge } from '@auxx/ui/components/badge'
import { Banknote, CalendarRange, ExternalLink, Lock, Scale } from 'lucide-react'
import Link from 'next/link'
import { useMemo } from 'react'
import { BankAccountPicker } from '~/components/accounting/ui/bank-account-picker'
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
import { ProviderAgreementSettingsSection } from './provider-agreement-section'
import { QuickbooksSettingsSection } from './quickbooks-section'
import { SetupStatusSection } from './setup-status-section'

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/

/**
 * One row per `PaymentMethod`, in the order a bookkeeper meets them.
 *
 * The keys come from `PAYMENT_ROUTE_SETTING_KEYS`; only the copy is local. The
 * input itself is rendered by `SettingsFieldRow` from the catalog entry, so the
 * three destinations are declared exactly once, in the catalog.
 */
const PAYMENT_ROUTE_ROWS = [
  {
    key: PAYMENT_ROUTE_SETTING_KEYS.cash,
    title: 'Cash',
    description: 'Banked in a run, so it waits to be grouped.',
  },
  {
    key: PAYMENT_ROUTE_SETTING_KEYS.check,
    title: 'Check',
    description: 'Five cheques banked together are one bank line.',
  },
  {
    key: PAYMENT_ROUTE_SETTING_KEYS.card,
    title: 'Card',
    description: 'Settles as a net payout, so it clears rather than banks.',
  },
  {
    key: PAYMENT_ROUTE_SETTING_KEYS.bank,
    title: 'Bank transfer',
    description: 'ACH or wire - arrives on its own line.',
  },
  {
    key: PAYMENT_ROUTE_SETTING_KEYS.other,
    title: 'Other',
    description: 'The unknown rail. Undeposited funds is the safe unknown.',
  },
] as const

/**
 * The five route keys, plus the one bank account a `cash` route needs.
 *
 * `cashBankAccountId` rides in the same draft slice as the routes it depends
 * on: they save and discard together, and a row shown only while a route
 * above reads `cash` has nothing sensible to save on its own.
 */
const PAYMENT_ROUTE_DRAFT_KEYS = [
  ...PAYMENT_ROUTE_ROWS.map((row) => row.key),
  ACCOUNTING_KEYS.cashBankAccountId,
]

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
  const readiness = useMemo(
    () => resolveSetupReadiness(buildReadinessRecord(getSetting)),
    [getSetting]
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

  // ── Section: where payments land (plans/accounting/tasks/06 §2.3) ────────
  // Its own slice, like every other section on this page: the route table
  // validates nothing and could later save through a different mutation.
  const routes = useAccountingSetupDraft(PAYMENT_ROUTE_DRAFT_KEYS)
  // Shown only while at least one route reads `cash` (brief 13 §2.4): `cash`
  // is no longer a role, so the bank account it lands in has to be named
  // somewhere, and there is nothing to name while nothing routes there.
  const anyRouteIsCash = PAYMENT_ROUTE_ROWS.some((row) => routes.draft[row.key] === 'cash')

  // ── Section 3: absorption rates ──────────────────────────────────────────
  const absorption = useAccountingSetupDraft(ABSORPTION_DRAFT_KEYS)
  const { draft: absorptionDraft, patch: patchAbsorption } = absorption

  const absorptionValid = everyMinorUnitValid(absorptionDraft, ABSORPTION_DRAFT_KEYS)

  const dirty = period.dirty || absorption.dirty || routes.dirty
  const isSaving =
    period.isSaving || absorption.isSaving || routes.isSaving || isBatchUpdatingOrgSettings
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

          Left is what you FILL IN - the three draft-backed forms feeding the one
          save bar. Right is what the page DOES or REPORTS: both sections own
          their own actions and neither writes the drafts.

          ⚠️ The split was rebalanced when the org-wide standard-cost ROLL moved
          to Parts > Settings > Costing (money 52 §2.2). That section rendered
          every part it would revalue - roughly 2000px on a real chart - and was
          the whole reason the right column was the tall one, and the reason the
          provider had to sit on the left to avoid being stranded a screen below
          it. With the roll gone the right column is short, so the provider moved
          across: it owns no settings values, stays out of all three draft slices
          and adds nothing to `DRAFT_KEYS`, which makes it a "what the page does"
          section, not a "what you fill in" one.

          ⚠️ On mobile the columns stack, so the reading order is
          period -> routes -> absorption -> setup -> provider. That is the trade
          for column-major flow, and it is the right way round: what you type
          comes before what you press.
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

                {/*
                  🛑 Deliberately NOT frozen, unlike the two rows above it.

                  Those rewrite the arithmetic behind entries that have already
                  posted, so they lock at the first claim. This one is a MODE: it
                  decides what happens to the NEXT sync and rewrites nothing that
                  exists, so an organization that has been posting for a year must
                  still be able to turn it on - or off, the moment a run surprises
                  them. It carries no `readOnly` for that reason.

                  Rendered straight from the catalog entry by `SettingsFieldRow`,
                  so the two modes are declared exactly once, beside the mode
                  union the runner reads.
                */}
                <SettingsFieldRow
                  settingKey={ACCOUNTING_KEYS.fulfillmentPosting}
                  title='Post fulfillments'
                  description='Automatic posts one entry per ship day after every connector sync. Manual waits for the posting dialog, where the preview is the review.'
                  {...period.controlled(ACCOUNTING_KEYS.fulfillmentPosting)}
                />
              </FieldPanel>
            </SettingsSection>

            <SettingsSection
              icon={Banknote}
              title='Where payments land'
              description='Which ledger account a received payment posts to, by how it was collected. Declared once here and read by every payment.'>
              <FieldPanel
                className='mt-1 p-0'
                resizeId='accounting-general-payment-routes'
                defaultLabelWidth={220}>
                {PAYMENT_ROUTE_ROWS.map((row) => (
                  <SettingsFieldRow
                    key={row.key}
                    settingKey={row.key}
                    title={row.title}
                    description={row.description}
                    {...routes.controlled(row.key)}
                  />
                ))}

                {anyRouteIsCash && (
                  <SettingsFieldRow
                    settingKey={ACCOUNTING_KEYS.cashBankAccountId}
                    title='Cash bank account'
                    description='Where a payment routed to cash is banked. A cash-routed payment refuses to post until this is set.'>
                    <BankAccountPicker
                      value={readText(routes.draft[ACCOUNTING_KEYS.cashBankAccountId])}
                      onChange={(id) =>
                        routes.patch({
                          [ACCOUNTING_KEYS.cashBankAccountId]: id as SettingValue,
                        })
                      }
                    />
                  </SettingsFieldRow>
                )}
              </FieldPanel>

              <p className='text-muted-foreground text-xs'>
                Cash and cheques are banked in a run, so they wait in undeposited funds until a
                deposit groups them into the one line the statement shows. An ACH arrives on its own
                line and goes straight to the bank account. A card settles as a net payout days
                later, so it lands in a clearing account that the payout entry drains. Getting one
                of these wrong still balances the books, and silently stops that rail from ever
                matching a bank line.
              </p>
            </SettingsSection>

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

          <div className='flex flex-col gap-8'>
            <SetupStatusSection
              readiness={readiness}
              finalizedAt={readText(getSetting(ACCOUNTING_KEYS.setupFinalizedAt))}
              finalizedByUserId={readText(getSetting(ACCOUNTING_KEYS.setupFinalizedByUserId))}
              hasUnsavedChanges={dirty}
              isFinalizing={isBatchUpdatingOrgSettings}
              onFinalize={handleFinalize}
            />

            {/*
              The export target, last: the books are kept here whether or not
              anything is connected (decision `P1`), so the provider follows the
              period and the rates rather than leading them. It owns no settings
              values, stays out of all three draft slices, adds nothing to
              `DRAFT_KEYS`, and must never read as a readiness gate.

              ⚠️ It sits in the RIGHT column now, and it must still not be placed
              after both columns. Observed 2026-08-28 on `abgwpa1l81reht2zmwrcihfu`
              while it was below both: it sat alone off the bottom of the page and
              read as missing.
            */}
            <QuickbooksSettingsSection />

            {/*
              Directly under the provider it asks about, and after it: there is
              nothing to compare until something is connected, and the section
              itself says so rather than disappearing (brief 20 §8.3). It owns no
              settings values either, so it stays out of all three draft slices
              and adds nothing to `DRAFT_KEYS`, exactly like the section above.
            */}
            <ProviderAgreementSettingsSection />
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
            if (period.dirty) period.save()
            if (absorption.dirty) absorption.save()
            // 🛑 `routes` counts toward `dirty` and so raises this bar, so it
            // has to be saved by it too. It was missing here, which made the
            // payment-route rows the one section on the page whose Save
            // appeared, did nothing, and left the bar up.
            if (routes.dirty) routes.save()
          }}
          onDiscard={() => {
            if (period.dirty) period.discard()
            if (absorption.dirty) absorption.discard()
            if (routes.dirty) routes.discard()
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
