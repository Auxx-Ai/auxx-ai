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
// This page keeps what its nav description claims: period, export and setup
// status. Standard cost lives on Parts > Manage > General.

import { FieldType } from '@auxx/database/enums'
import {
  didLedgerAccept,
  isValidTimeZone,
  OPENING_FROM_NOTHING_SETTING_KEY,
  resolveSetupReadiness,
} from '@auxx/lib/accounting/ledger/client'
import { FeatureKey, PermissionKey } from '@auxx/lib/permissions/client'
import type { SettingValue } from '@auxx/lib/settings/client'
import { toastError } from '@auxx/ui/components/toast'
import { CalendarRange, ExternalLink, Lock, Send } from 'lucide-react'
import Link from 'next/link'
import { useMemo } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { EmptyState } from '~/components/global/empty-state'
import { FieldPanel } from '~/components/global/forms/field-panel'
import { FormSaveBar } from '~/components/global/forms/form-save-bar'
import SettingsPage, { SettingsSection } from '~/components/global/settings-page'
import { TimeZonePicker } from '~/components/pickers/timezone-picker'
import { SettingsFieldRow } from '~/components/settings/settings-field-row'
import { useConfirm } from '~/hooks/use-confirm'
import { useSettings } from '~/hooks/use-settings'
import { useUser } from '~/hooks/use-user'
import { useRequireCapability } from '~/providers/capabilities-provider'
import {
  useDehydratedOrganizationId,
  useDehydratedStateContext,
} from '~/providers/dehydrated-state-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'
import {
  FREEZE_REASON,
  useAccountingSettingsFreeze,
} from '../../hooks/use-accounting-settings-freeze'
import { useAccountingSetupDraft } from '../../hooks/use-accounting-setup-draft'
import {
  ACCOUNTING_KEYS,
  buildReadinessRecord,
  EXPORT_DRAFT_KEYS,
  PERIOD_DRAFT_KEYS,
  readText,
} from './accounting-settings-keys'
import { FrozenLock } from './frozen-lock'
import { SetupStatusSection } from './setup-status-section'

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/
const EXPORT_MODE_LABEL = { transaction: 'Transaction', summary: 'Summary' } as const

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

const BREADCRUMBS = [
  { title: 'Accounting', href: '/app/accounting' },
  { title: 'Settings' },
  { title: 'General' },
]

const PAGE_DESCRIPTION =
  'The period the books are kept in, how postings export, and how setup is finalized.'

export function AccountingGeneralSettingsPage() {
  useRequireCapability(PermissionKey.ledgerView)
  const { hasAccess } = useFeatureFlags()
  const { userId } = useUser()
  const { getSetting, isBatchUpdatingOrgSettings } = useSettings({ scope: 'GENERAL' })
  const organizationId = useDehydratedOrganizationId()
  const { patchSettings } = useDehydratedStateContext()
  const { frozen } = useAccountingSettingsFreeze()

  // The shared predicate, over the settings record and the opening entry. The server
  // re-checks it on Finalize (`ledger.finalizeSetup`), the same door the wizard uses.
  const opening = api.ledgerOpening.get.useQuery()
  const openingPosted = opening.data?.entry?.status === 'posted'
  const openingSummary = opening.data?.summary
  const readiness = useMemo(
    () =>
      resolveSetupReadiness(buildReadinessRecord(getSetting), {
        ...(openingSummary ? { opening: { posted: openingPosted, summary: openingSummary } } : {}),
      }),
    [getSetting, openingPosted, openingSummary]
  )
  const fromNothing = getSetting(OPENING_FROM_NOTHING_SETTING_KEY) === true
  const awaitingPost =
    readiness.finalized && !fromNothing && !!opening.data?.entry && !openingPosted

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

  // ── Section 2: the export (TARGET §3, gate 2) ────────────────────────────
  const exportSettings = useAccountingSetupDraft(EXPORT_DRAFT_KEYS)
  const { draft: exportDraft, patch: patchExport } = exportSettings

  const exportCutover = readText(exportDraft[ACCOUNTING_KEYS.exportModeCutover])
  const exportCutoverError =
    exportCutover && !DATE_KEY.test(exportCutover) ? 'Must be a date, YYYY-MM-DD.' : undefined
  const exportValid = !exportCutoverError
  const exportModeChanged =
    readText(exportDraft[ACCOUNTING_KEYS.exportMode]) !==
    readText(getSetting(ACCOUNTING_KEYS.exportMode))
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()

  /** A mode switch applies to every unbatched posting, so it says what that is first (101 E6). */
  async function confirmModeSwitch(): Promise<boolean> {
    const impact = await utils.ledger.exportBatches.modeSwitchImpact
      .fetch(undefined, { staleTime: 0 })
      .catch((error: Error) => {
        toastError({
          title: 'Could not check the export before switching mode',
          description: error.message,
        })
        return null
      })
    if (!impact) return false
    const next =
      readText(exportDraft[ACCOUNTING_KEYS.exportMode]) === 'summary' ? 'summary' : 'transaction'
    const confirmed = await confirm({
      title: `Switch export to ${EXPORT_MODE_LABEL[next]}?`,
      description: [
        `${plural(impact.unbatched, 'unbatched posting')} will leave in ${EXPORT_MODE_LABEL[next]} mode.`,
        `${plural(impact.held, 'held batch', 'held batches')} keep ${EXPORT_MODE_LABEL[impact.mode]} and send as built.`,
        `${plural(impact.straddlingOrders, 'order')} with a posted payment and no posted shipment may have the two leave in different modes.`,
        'Switch at a month boundary with Export from set to it, after the Outbox is empty.',
      ].join(' '),
      confirmText: 'Switch mode',
      cancelText: 'Cancel',
    })
    return confirmed === true
  }

  const dirty = period.dirty || exportSettings.dirty
  const isSaving = period.isSaving || exportSettings.isSaving || isBatchUpdatingOrgSettings
  const saveDisabled = (period.dirty && !periodValid) || (exportSettings.dirty && !exportValid)

  async function handleSave() {
    if (exportSettings.dirty && exportModeChanged && !(await confirmModeSwitch())) return
    // Every slice that counts toward `dirty` must be saved here, or
    // its Save appears, does nothing, and leaves the bar up.
    if (period.dirty) period.save()
    if (exportSettings.dirty) exportSettings.save()
  }

  const finalizeSetup = api.ledger.finalizeSetup.useMutation()
  async function handleFinalize() {
    try {
      const result = await finalizeSetup.mutateAsync()
      if (organizationId && result.finalizedNow) {
        patchSettings(organizationId, {
          [ACCOUNTING_KEYS.setupState]: 'finalized',
          [ACCOUNTING_KEYS.setupFinalizedAt]: new Date().toISOString(),
          [ACCOUNTING_KEYS.setupFinalizedByUserId]: userId ?? null,
        })
      }
      if (result.opening && !didLedgerAccept(result.opening)) {
        toastError({
          title: 'Setup is finalized, but the opening entry did not post',
          description: result.opening.error ?? `It came back ${result.opening.status}.`,
        })
      }
    } catch (error) {
      toastError({
        title: 'Error finalizing setup',
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      await utils.ledgerOpening.get.invalidate()
    }
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
        {/* Two independent flex columns: left is the draft-backed sections the save bar covers,
            right is Setup status. */}
        <div className='grid grid-cols-1 items-start gap-8 lg:grid-cols-2'>
          <div className='flex flex-col gap-8'>
            <SettingsSection
              icon={CalendarRange}
              title='Accounting period'
              description='The month the previous system last closed, the timezone every period key is derived in, and the month the fiscal year turns over.'>
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
                  🛑 NOT gated on `frozen`, unlike the two rows above. They are
                  frozen because changing them rewrites a posted entry's
                  `txnDate`/`periodKey`; this one writes nothing to the ledger at
                  all. It moves where a READ splits prior years from this year,
                  so an org that picked the wrong month can still correct it.
                  The catalog renders the twelve months off `FISCAL_YEAR_START_MONTH_OPTIONS`.
                */}
                <SettingsFieldRow
                  settingKey={ACCOUNTING_KEYS.fiscalYearStartMonth}
                  title='Fiscal year starts'
                  value={periodDraft[ACCOUNTING_KEYS.fiscalYearStartMonth]}
                  onChange={(value) =>
                    patchPeriod({
                      [ACCOUNTING_KEYS.fiscalYearStartMonth]: value as SettingValue,
                    })
                  }
                />
              </FieldPanel>

              <p className='text-muted-foreground text-xs'>
                Every entry is dated in this timezone and nothing before the cutoff is kept. At the
                fiscal year&apos;s first day every report resets revenue and expense accounts and
                rolls what came before into retained earnings — no closing entry is posted, so
                changing the month re-frames the reports without touching a booked entry. What
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

            <SettingsSection
              icon={Send}
              title='Export'
              description='How postings leave for the accounting provider, and the date export starts from. The books underneath are identical in every mode.'>
              <FieldPanel
                className='mt-1 p-0'
                resizeId='accounting-general-export'
                defaultLabelWidth={220}>
                <SettingsFieldRow
                  settingKey={ACCOUNTING_KEYS.exportMode}
                  {...exportSettings.controlled(ACCOUNTING_KEYS.exportMode)}
                />
                <SettingsFieldRow
                  settingKey={ACCOUNTING_KEYS.exportModeCutover}
                  title='Export from'>
                  <DateTextField
                    value={exportCutover}
                    error={exportCutoverError}
                    onChange={(value) =>
                      patchExport({ [ACCOUNTING_KEYS.exportModeCutover]: value as SettingValue })
                    }
                  />
                </SettingsFieldRow>
              </FieldPanel>

              <p className='text-muted-foreground text-xs'>
                Postings dated before this date are never exported, in either mode. Unset, export
                starts from the date chosen when the book was connected. A mode switch applies to
                every posting not yet batched; a batch already built keeps its mode. The per-avenue
                hold, send and grain switches are under{' '}
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
              isFinalizing={finalizeSetup.isPending}
              awaitingPost={awaitingPost}
              onFinalize={handleFinalize}
            />
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
          onSave={handleSave}
          onDiscard={() => {
            if (period.dirty) period.discard()
            if (exportSettings.dirty) exportSettings.discard()
          }}
          saveDisabled={saveDisabled}
        />
        <ConfirmDialog />
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
 * Export from, the export floor (101 E6). `TEXT` in the catalog for the same
 * reason `MonthTextField` gives; unlike the cutoff month above it is never
 * frozen by setup - an org may move it any time it changes how it exports.
 */
function DateTextField({
  value,
  error,
  onChange,
  disabled,
  className,
}: {
  value: string | null
  error?: string
  onChange: (value: string | null) => void
  disabled?: boolean
  className?: string
}) {
  return (
    <div className={className}>
      <FieldInputAdapter
        fieldType={FieldType.TEXT}
        value={value ?? ''}
        disabled={disabled}
        onChange={(next) => onChange(((next as string) || null) ?? null)}
        placeholder="Not set - the connected book's start date applies"
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
