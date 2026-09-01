// apps/web/src/components/manufacturing/ui/settings/tariffs-settings-page.tsx
'use client'

// Parts > Settings > Tariffs (money 29-tariff-schedule.md §6.1).
//
// Shape B, master-detail: `SettingsPage` over a `MasterDetailSplit`, whose right
// column is a PERSISTENT editor pane, docked at `lg` and a floating drawer below
// it.
//
// Two tabs, the active one in `useQueryState('s')`: Codes (the registry) and
// Classification (every priced supplier offer, classified or not - task 30 §6).
// Codes is the entry point even though a first-run org has its work on the
// other tab, because nothing can be classified before a code exists.
//
// 🛑 THE GATE IS THE RECORD CAPABILITY, not `settingsManage` - decided in §12
// (d) and it is the opposite call from the sibling Parts > General page. Both
// definitions are ordinary VISIBLE entities whose writes go through
// `record.create` / `record.update`, and `UnifiedCrudHandler` asserts
// `assertEditEntity(defId)` on every one of those paths. Gating on
// `settingsManage` would show this page to an actor the mutation then refuses on
// save. `tags-list.tsx` made the same correction for the same reason.
//
// 🛑 Codes is the entry point even though a first-run org has no work to do
// here, because nothing can be classified before a code exists.

import { FieldType } from '@auxx/database/enums'
import type { FieldType as FieldTypeValue } from '@auxx/database/types'
import { type RecordId, toRecordId } from '@auxx/lib/resources/client'
import { Button } from '@auxx/ui/components/button'
import { ResponsiveTabs } from '@auxx/ui/components/responsive-tabs'
import { toastError } from '@auxx/ui/components/toast'
import { generateId } from '@auxx/utils'
import { Globe, Package, RefreshCw } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { useCallback, useMemo, useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { MasterDetailSplit } from '~/components/global/master-detail-split'
import SettingsPage from '~/components/global/settings-page'
import { useResourceProperty } from '~/components/resources'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import {
  type CreatedRecordInstance,
  type SeedFieldValue,
  useSeedCreatedRecord,
} from '~/components/resources/hooks/use-seed-created-record'
import { useConfirm } from '~/hooks/use-confirm'
import { useSettings } from '~/hooks/use-settings'
import { useAccess, useRequireEntityEdit } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import {
  useOfferClassification,
  VENDOR_PART_TARIFF_ATTRS,
} from '../../hooks/use-offer-classification'
import {
  useTariffCountryFieldOptions,
  useTariffCountryLabels,
  useTariffSchedule,
} from '../../hooks/use-tariff-schedule'
import {
  composeTariffLabel,
  TARIFF_CODE_ATTRS,
  TARIFF_RATE_ATTRS,
  type TariffCode,
  type TariffCodeDraft,
  type TariffRate,
} from '../../tariff-types'
import { TariffClassificationEditor } from './tariff-classification-editor'
import { TariffClassificationList } from './tariff-classification-list'
import { TariffCodeEditor, type TariffCodeValues } from './tariff-code-editor'
import { TariffCodesList } from './tariff-codes-list'
import type { TariffRateValues } from './tariff-rate-history'

const BREADCRUMBS = [
  { title: 'Parts', href: '/app/parts' },
  { title: 'Settings' },
  { title: 'Tariffs' },
]

const PAGE_DESCRIPTION =
  'Harmonized codes by country of origin, and the rates behind them. A rate is a function of what the thing is, where it was made, and when - so a code is a classification for an origin, and its rates are dated rows that are never edited in place.'

const TABS = [
  { value: 'codes', label: 'Codes', icon: Globe },
  { value: 'classification', label: 'Classification', icon: Package },
]

type TariffsTab = 'codes' | 'classification'

export function TariffsSettingsPage() {
  const [tab, setTab] = useQueryState('s', { defaultValue: 'codes' as string })
  const activeTab: TariffsTab = tab === 'classification' ? 'classification' : 'codes'

  const {
    codes,
    ratesByCode,
    codeDefId,
    rateDefId,
    isLoading,
    appendCode,
    removeCode,
    appendRate,
    removeRate,
  } = useTariffSchedule()

  // The client mirror of what the server will actually do. An unresolved def id
  // is NOT KNOWN rather than denied - the resource store hydrates
  // asynchronously, and redirecting on the pre-hydration render would eject a
  // legitimate admin on every refresh.
  useRequireEntityEdit(codeDefId)

  const { canEditEntity } = useAccess()
  const canEditCodes = codeDefId ? canEditEntity(codeDefId) : false
  // 🛑 Asked SEPARATELY for the rate def. The two definitions carry their own
  // per-def grants, so a member who may edit codes is not automatically allowed
  // to append a rate - and an affordance that is refused on click is worse than
  // one that is absent.
  const canEditRates = rateDefId ? canEditEntity(rateDefId) : false

  // ── Apply rate changes (29 §8, §12 a) ───────────────────────────────────
  //
  // A future-dated rate row does not apply itself: nothing is written at
  // midnight and the full recalc has no scheduled caller, so `part_cost` keeps
  // the old rate until some unrelated vendor-price edit sweeps the part. The
  // decision was an explicit action rather than a daily sweep, because nothing
  // else in this subsystem revalues without a person.
  //
  // 🛑 Gated on PART edit, not on the code or rate defs, because `part` rows
  // are what the mutation writes and what `purchasing.applyTariffSchedule`
  // asserts. Same rule as the two gates above: a button the server refuses is
  // worse than one that is absent.
  const partDefId = useResourceProperty('part', 'id')
  const canApplyRates = !!partDefId && canEditEntity(partDefId)
  const applyRates = api.purchasing.applyTariffSchedule.useMutation()
  const [lastApply, setLastApply] = useState<{ affectedParts: number; changed: number } | null>(
    null
  )

  const handleApplyRates = useCallback(async () => {
    try {
      const result = await applyRates.mutateAsync()
      setLastApply({ affectedParts: result.affectedParts, changed: result.changedPartIds.length })
    } catch (error) {
      toastError({
        title: 'Error applying rate changes',
        description: error instanceof Error ? error.message : 'Could not reprice the parts.',
      })
    }
  }, [applyRates])

  const countryOptions = useTariffCountryFieldOptions(codeDefId)
  const countryLabels = useTariffCountryLabels(codeDefId)

  // ONE `Date` for the whole page. Resolving "today" per row would let two rows
  // straddle midnight and disagree about which rate is in force.
  const today = useMemo(() => new Date(), [])

  // 🛑 The org's BOOK timezone, never the viewer's and never a bare UTC default.
  // `effectiveFrom` is a calendar day and `today` is an instant, so turning one
  // into the other is a timezone decision - and in UTC a rate starting March 2
  // puts a March 1 evening on the wrong side of the change, silently and by
  // exactly one day. Same key `use-ledger-period.ts` reads, and the same rule
  // `gather-month-end-inventory.ts` applies to period membership. `UTC` is the
  // fallback only when the org has never set one.
  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const bookTimeZone = (getSetting('accounting.bookTimeZone') as string) || 'UTC'

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null)

  // ── The Classification tab's read and writes ────────────────────────────
  //
  // The country per code, so the offer list can filter by origin.
  const codeCountryById = useMemo(
    () => new Map(codes.map((code) => [code.id, code.country])),
    [codes]
  )
  const classification = useOfferClassification(codeCountryById)
  const canEditOffers = classification.vendorPartDefId
    ? canEditEntity(classification.vendorPartDefId)
    : false
  const selectedOffer = classification.offers.find((offer) => offer.id === selectedOfferId) ?? null

  // The phantom draft. The full field set lives inside the draft form instance
  // (keyed by `draftId`); this page tracks only enough to render the list's
  // phantom row and to know whether the selection is a draft.
  const [draft, setDraft] = useState<TariffCodeDraft | null>(null)
  const [confirm, ConfirmDialog] = useConfirm()

  const { saveMultipleAsync } = useSaveFieldValue({})
  const { seedCreatedRecord } = useSeedCreatedRecord()
  const createRecord = api.record.create.useMutation()
  const deleteRecord = api.record.delete.useMutation()

  // ── The code writes ─────────────────────────────────────────────────────
  //
  // 🛑 Refusals are NOT toasted here. A `(code, country)` collision belongs on
  // the code field in the editor, where the colliding value is still on screen;
  // the accounts page's chart writes make the same call, and "Could not save"
  // throws away the only sentence that says what to do next. Both mutations
  // expose their rejection to the editor rather than swallowing it.

  const handleCreateCode = useCallback(
    async (values: { code: string; country: string; description: string | null }) => {
      if (!codeDefId) throw new Error('Tariff codes are not available in this organization yet.')

      const result = await createRecord.mutateAsync({
        entityDefinitionId: codeDefId,
        values: {
          [TARIFF_CODE_ATTRS.code]: values.code,
          [TARIFF_CODE_ATTRS.country]: values.country,
          [TARIFF_CODE_ATTRS.description]: values.description,
        },
      })

      const seedValues: SeedFieldValue[] = [
        { fieldId: TARIFF_CODE_ATTRS.code, value: values.code, fieldType: FieldType.TEXT },
        {
          fieldId: TARIFF_CODE_ATTRS.country,
          value: values.country,
          fieldType: FieldType.SINGLE_SELECT,
        },
        {
          fieldId: TARIFF_CODE_ATTRS.description,
          value: values.description,
          fieldType: FieldType.TEXT,
        },
      ]
      seedCreatedRecord({
        entityDefinitionId: codeDefId,
        recordId: result.recordId,
        instance: result.instance as CreatedRecordInstance,
        values: seedValues,
      })
      appendCode({
        ...result.instance,
        recordId: result.recordId,
        fieldValues: {
          [TARIFF_CODE_ATTRS.code]: values.code,
          [TARIFF_CODE_ATTRS.country]: values.country,
          [TARIFF_CODE_ATTRS.description]: values.description,
        },
      })

      const created: TariffCode = {
        id: result.instance.id,
        recordId: result.recordId,
        code: values.code,
        country: values.country,
        description: values.description,
      }
      return created
    },
    [codeDefId, createRecord, seedCreatedRecord, appendCode]
  )

  const handleUpdateCode = useCallback(
    async (recordId: RecordId, patch: Partial<TariffCodeValues>) => {
      const writes: Array<{ fieldId: string; value: unknown; fieldType: FieldTypeValue }> = []
      if (patch.code !== undefined) {
        writes.push({
          fieldId: TARIFF_CODE_ATTRS.code,
          value: patch.code,
          fieldType: FieldType.TEXT,
        })
      }
      if (patch.country !== undefined) {
        writes.push({
          fieldId: TARIFF_CODE_ATTRS.country,
          value: patch.country,
          fieldType: FieldType.SINGLE_SELECT,
        })
      }
      if (patch.description !== undefined) {
        writes.push({
          fieldId: TARIFF_CODE_ATTRS.description,
          value: patch.description,
          fieldType: FieldType.TEXT,
        })
      }
      if (writes.length === 0) return
      await saveMultipleAsync(recordId, writes)
    },
    [saveMultipleAsync]
  )

  /**
   * Remove a code.
   *
   * ✅ The confirm says what removal does NOT do, because that is the part
   * somebody about to click it will worry about: a `stock_movement` freezes its
   * cost when it is written and is `updatable: false`, so nothing already valued
   * moves. What changes is forward-looking - offers still pointing here fall
   * back to no duty at all.
   */
  const handleRemoveCode = useCallback(
    async (code: TariffCode) => {
      const rateCount = (ratesByCode.get(code.id) ?? []).length
      const confirmed = await confirm({
        title: 'Remove tariff code?',
        description: `${composeTariffLabel(code.code, code.country)} comes out of the registry${
          rateCount > 0 ? `, along with ${rateCount} rate ${rateCount === 1 ? 'row' : 'rows'}` : ''
        }. Nothing already received or valued changes - a movement freezes its cost when it is written. Supplier offers still pointing here will estimate with no duty until they are pointed somewhere else.`,
        confirmText: 'Remove',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (!confirmed) return

      await deleteRecord.mutateAsync({ recordId: code.recordId })
      removeCode(code.id)
      if (selectedId === code.id) setSelectedId(null)
      if (draft?.recordId === code.id) setDraft(null)
    },
    [ratesByCode, confirm, deleteRecord, removeCode, selectedId, draft]
  )

  // ── The offer writes ────────────────────────────────────────────────────
  //
  // The same two attributes the supplier dialog writes, through the same door.
  // `mfg-vendor-part-tariff-code` / `-tariff-rate` recalculate the part's cost
  // on the server; nothing here computes a number.

  const handleSetOfferCode = useCallback(
    async (recordId: RecordId, tariffCodeId: string | null) => {
      if (!codeDefId) throw new Error('Tariff codes are not available in this organization yet.')
      const ok = await saveMultipleAsync(recordId, [
        {
          fieldId: VENDOR_PART_TARIFF_ATTRS.tariffCode,
          value: tariffCodeId ? [toRecordId(codeDefId, tariffCodeId)] : [],
          fieldType: FieldType.RELATIONSHIP,
        },
      ])
      if (ok === false) throw new Error('Could not save the tariff code.')
    },
    [codeDefId, saveMultipleAsync]
  )

  const handleSetOfferOverride = useCallback(
    async (recordId: RecordId, rate: number | null) => {
      const ok = await saveMultipleAsync(recordId, [
        { fieldId: VENDOR_PART_TARIFF_ATTRS.tariffRate, value: rate, fieldType: FieldType.NUMBER },
      ])
      if (ok === false) throw new Error('Could not save the override.')
    },
    [saveMultipleAsync]
  )

  // ── The rate writes ─────────────────────────────────────────────────────

  const rateWrites = useCallback(
    (values: TariffRateValues) => [
      { fieldId: TARIFF_RATE_ATTRS.rate, value: values.rate, fieldType: FieldType.NUMBER },
      {
        fieldId: TARIFF_RATE_ATTRS.effectiveFrom,
        value: values.effectiveFrom,
        fieldType: FieldType.DATE,
      },
      {
        fieldId: TARIFF_RATE_ATTRS.authority,
        value: values.authority.trim() || null,
        fieldType: FieldType.TEXT,
      },
      {
        fieldId: TARIFF_RATE_ATTRS.chapter99Code,
        value: values.chapter99Code.trim() || null,
        fieldType: FieldType.TEXT,
      },
      {
        fieldId: TARIFF_RATE_ATTRS.note,
        value: values.note.trim() || null,
        fieldType: FieldType.TEXT,
      },
    ],
    []
  )

  const handleAddRate = useCallback(
    async (code: TariffCode, values: TariffRateValues) => {
      if (!rateDefId) throw new Error('Tariff rates are not available in this organization yet.')

      const writes = rateWrites(values)
      const createValues: Record<string, unknown> = {
        [TARIFF_RATE_ATTRS.tariffCode]: code.recordId,
      }
      for (const write of writes) createValues[write.fieldId] = write.value

      const result = await createRecord.mutateAsync({
        entityDefinitionId: rateDefId,
        values: createValues,
      })

      seedCreatedRecord({
        entityDefinitionId: rateDefId,
        recordId: result.recordId,
        instance: result.instance as CreatedRecordInstance,
        values: [
          {
            fieldId: TARIFF_RATE_ATTRS.tariffCode,
            value: code.recordId,
            fieldType: FieldType.RELATIONSHIP,
          },
          ...writes,
        ],
      })
      appendRate({
        ...result.instance,
        recordId: result.recordId,
        fieldValues: { ...createValues, [TARIFF_RATE_ATTRS.tariffCode]: [code.recordId] },
      })
    },
    [rateDefId, rateWrites, createRecord, seedCreatedRecord, appendRate]
  )

  const handleUpdateRate = useCallback(
    async (rate: TariffRate, values: TariffRateValues) => {
      await saveMultipleAsync(rate.recordId, rateWrites(values))
    },
    [saveMultipleAsync, rateWrites]
  )

  /**
   * Remove a rate row.
   *
   * ⚠️ Removing the row that is currently in force does NOT leave the code
   * unrated - the previous row for that authority becomes live again, which is
   * exactly what §1.4's "the next row's start is the previous row's end" model
   * means and is not obvious from a list. The confirm says so.
   */
  const handleRemoveRate = useCallback(
    async (rate: TariffRate) => {
      const confirmed = await confirm({
        title: 'Remove rate row?',
        description:
          'The row is deleted and the previous row for the same authority becomes the one in force again. If this rate was recorded because an action actually changed, add a new dated row instead - deleting rewrites what the schedule says was true.',
        confirmText: 'Remove',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (!confirmed) return

      // 🛑 Caught HERE, unlike every other write on this page. A row action has
      // no field for a refusal to land on - the row it came from is about to be
      // gone - so this is the one place a toast is the right channel, and
      // swallowing the rejection is also what keeps the row's `onClick` from
      // leaving an unhandled promise behind.
      try {
        await deleteRecord.mutateAsync({ recordId: rate.recordId })
        removeRate(rate.id)
      } catch (error) {
        toastError({
          title: 'Error removing the rate',
          description: error instanceof Error ? error.message : 'Could not remove the rate row.',
        })
      }
    },
    [confirm, deleteRecord, removeRate]
  )

  // ── The phantom draft ───────────────────────────────────────────────────

  const handleSelect = useCallback(
    (id: string | null) => {
      // Selecting anything other than the draft itself - or its committed
      // record, which keeps the draft form mounted - drops the draft.
      if (draft && id !== draft.draftId && id !== draft.recordId) setDraft(null)
      setSelectedId(id)
    },
    [draft]
  )

  const handleAddDraft = useCallback(() => {
    if (draft && !draft.recordId) {
      setSelectedId(draft.draftId) // uncommitted one exists - re-select it
      return
    }
    const draftId = generateId('draft')
    setDraft({ draftId, code: '', country: null, description: '' })
    setSelectedId(draftId)
  }, [draft])

  const handleDraftChange = useCallback((patch: Partial<TariffCodeValues>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev))
  }, [])

  /** First create resolved: swap selection to the real id but KEEP the draft, so
   *  the draft form stays mounted and text typed mid-round-trip is not lost. */
  const handleDraftCommitted = useCallback((recordId: string) => {
    setDraft((prev) => (prev ? { ...prev, recordId } : prev))
    setSelectedId(recordId)
  }, [])

  const editorContent = (
    <TariffCodeEditor
      selectedId={selectedId}
      codes={codes}
      ratesByCode={ratesByCode}
      today={today}
      bookTimeZone={bookTimeZone}
      countryOptions={countryOptions}
      draft={draft}
      onDraftChange={handleDraftChange}
      onCreate={handleCreateCode}
      onDraftCommitted={handleDraftCommitted}
      onUpdate={handleUpdateCode}
      onRemove={handleRemoveCode}
      canEditRates={canEditRates}
      onAddRate={handleAddRate}
      onUpdateRate={handleUpdateRate}
      onRemoveRate={handleRemoveRate}
    />
  )

  // 🛑 "The definitions are not in this org" is NOT "no codes yet". The two
  // render the same empty list and mean opposite things - one is a schedule
  // waiting to be filled in, the other is a page with nothing behind it, and
  // telling somebody to add a code that cannot be created is the worse of the
  // two mistakes. `entityDefIds` resolve from `record.listAll`, so this is only
  // reachable before entity migration 119 has run for the org.
  if (!isLoading && !codeDefId) {
    return (
      <SettingsPage title='Tariffs' description={PAGE_DESCRIPTION} breadcrumbs={BREADCRUMBS}>
        <EmptyState
          icon={Globe}
          title='Tariffs Not Available'
          description='The tariff registry has not been provisioned for this organization yet.'
          button={<div className='h-12' />}
        />
      </SettingsPage>
    )
  }

  const classificationEditor = (
    <TariffClassificationEditor
      offer={selectedOffer}
      scheduleTariff={selectedOffer ? classification.scheduleById.get(selectedOffer.id) : undefined}
      unavailable={classification.unavailable}
      tariffCodeDefId={codeDefId}
      canEdit={canEditOffers}
      onSetCode={handleSetOfferCode}
      onSetOverride={handleSetOfferOverride}
    />
  )

  // The result stays on the page rather than in a toast: it is a number the
  // person will read against the list below it, and "0 of 40 changed" is as
  // much of an answer as "12 of 40" - it says the schedule was already applied.
  const applyButton = canApplyRates ? (
    <div className='flex items-center gap-3'>
      {lastApply && !applyRates.isPending && (
        <span className='text-xs text-muted-foreground'>
          {lastApply.affectedParts === 0
            ? 'No classified offers to reprice'
            : `${lastApply.changed} of ${lastApply.affectedParts} ${
                lastApply.affectedParts === 1 ? 'part' : 'parts'
              } changed`}
        </span>
      )}
      <Button
        variant='outline'
        size='sm'
        onClick={() => void handleApplyRates()}
        disabled={isLoading || codes.length === 0}
        loading={applyRates.isPending}
        loadingText='Applying...'
        title='Reprice every part with a classified supplier offer at the rates in force today. Standard costs and movements are not touched.'>
        <RefreshCw />
        Apply rate changes
      </Button>
    </div>
  ) : undefined

  return (
    <SettingsPage
      title='Tariffs'
      description={PAGE_DESCRIPTION}
      breadcrumbs={BREADCRUMBS}
      button={applyButton}
      subHeader={
        <ResponsiveTabs
          value={activeTab}
          onValueChange={(next) => void setTab(next)}
          size='sm'
          items={TABS}
        />
      }>
      {activeTab === 'codes' ? (
        <MasterDetailSplit
          id='tariff-codes'
          pane={editorContent}
          paneTitle='Tariff code'
          paneOpen={!!selectedId}
          onPaneClose={() => handleSelect(null)}>
          <TariffCodesList
            codes={codes}
            ratesByCode={ratesByCode}
            today={today}
            bookTimeZone={bookTimeZone}
            countryLabels={countryLabels}
            // 🛑 Gate on the QUERY, never on an empty array. "No tariff codes
            // yet" is a claim about the org, and rendering it mid-load makes it
            // a false one.
            isLoading={isLoading}
            selectedId={selectedId}
            onSelect={handleSelect}
            draft={draft}
            onAddDraft={handleAddDraft}
            canEdit={canEditCodes}
          />
        </MasterDetailSplit>
      ) : (
        <MasterDetailSplit
          id='tariff-classification'
          pane={classificationEditor}
          paneTitle='Supplier offer'
          paneOpen={!!selectedOfferId}
          onPaneClose={() => setSelectedOfferId(null)}>
          <TariffClassificationList
            offers={classification.offers}
            countries={classification.countries}
            countryLabels={countryLabels}
            isLoading={classification.isLoading}
            selectedId={selectedOfferId}
            onSelect={setSelectedOfferId}
          />
        </MasterDetailSplit>
      )}

      <ConfirmDialog />
    </SettingsPage>
  )
}
