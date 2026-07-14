// apps/web/src/components/money/ui/line-builder/line-builder.tsx

'use client'

// The document-agnostic line-items builder (money MQ1 build spec §H.1, 01-ui.md #1).
// Lines render as `GridTreeRow`s under a plain grid header (Description / Qty /
// Unit cost / Total / actions) — the data-connectors mapping-editor idiom
// (mapping-row.tsx): one shared `grid-template-columns` keeps the number columns
// aligned across the header and every row. Line counts are small, so plain rows
// replace the virtualized `DynamicView` embed this used to be. Row/cell markup
// lives in `line-rows.tsx` — this file owns state, data fetching, and mutations.
//
// Data flow:
// - Line cell reads: `useSystemValues` (field-value store, autoFetch).
// - Line cell writes: `useSaveFieldValue` with systemAttribute keys — the
//   server-side field-change hooks (§F.2) recompute lineTotal + quote totals
//   and publish via realtime back into the same store.
// - Totals footer: pure client math via `computeDocumentTotals` /
//   `computeLineTotal` from `@auxx/lib/money/client` over store values — the
//   same function the server hook uses, so the optimistic footer and the
//   stored mirrors can never disagree.
// - Add: pushes a purely-local "phantom draft" row (`DraftLine`, line-rows.tsx)
//   — no mutation, no round-trip — with the catalog picker already open. The
//   record is only created on the draft's first real commit (catalog pick,
//   free-text name, description, qty/price blur, taxable toggle, or a
//   catalog-group pick), carrying every value accumulated on the draft in one
//   `record.create` call. The create result seeds the record + field-value
//   caches directly (`useSeedCreatedRecord`) — no `refresh()` — and the draft
//   is swapped for the now-real row. Edits that land while the create is in
//   flight keep mutating local draft state; once it resolves, anything that
//   changed since the snapshot was sent is flushed via `saveMultipleAsync`
//   against the real record. An untouched draft simply vanishes on unmount.
// - Reorder: dnd-kit sortable rows (grip handle) → `api.money.reorderLines`.
//   Draft rows aren't part of the sortable set — they pin after the real rows.
// - Delete: real rows → `api.record.delete` + `api.money.recomputeTotals`
//   (delete path doesn't fire field-change hooks, §F.2). Draft rows → local
//   splice, no network.

import { FieldType } from '@auxx/database/enums'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { generateId } from '@auxx/utils'
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { arrayMove, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Plus, ReceiptText } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import {
  type RecordId,
  type RecordMeta,
  toRecordId,
  useRecordList,
  useResource,
} from '~/components/resources'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { useSeedCreatedRecord } from '~/components/resources/hooks/use-seed-created-record'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'
import type { CatalogGroupPick, CatalogGroupPickLine } from './catalog-picker'
import {
  type DraftLine,
  DraftLineRow,
  freshDraft,
  LINE_COLS,
  LINE_COLS_READONLY,
  LineRow,
  relKeyForDocumentType,
} from './line-rows'
import { TotalsFooter } from './totals-footer'

// ─────────────────────────────────────────────────────────────────────────────
// Props / shared types
// ─────────────────────────────────────────────────────────────────────────────

export interface LineBuilderProps {
  documentRecordId: string
  documentType: 'quote' | 'work_order' | 'invoice'
  readOnly?: boolean
  /**
   * Scope the builder to a single visit's occurrence extras (work_order only, money 01-ui #13):
   * set → shows/creates lines stamped `line_item_visit_id = visitId`; unset → the job's per-cycle
   * set (`visitId` empty). The two sets never overlap — that split is enforced in `filters` below.
   */
  visitId?: string
}

const LINE_ITEM_SLUG = 'line-items'
const PAGE_SIZE = 100
/** Stable sort ref — `useRecordList` keys its cache off this object. */
const LINE_SORT = [{ id: 'sortOrder', desc: false }]

// Document billing mirrors read for the group-explode set-if-unset checks (steps 4–5,
// money 09-product-groups.md "Line-builder consumption") — the same attrs `TotalsFooter`
// reads, minus the invoice-only ledger-sync mirrors this doesn't need.
const QUOTE_BILLING_ATTRS = [
  'quote_discount_type',
  'quote_discount_value',
  'quote_tax_name',
  'quote_tax_rate',
]
const INVOICE_BILLING_ATTRS = [
  'invoice_discount_type',
  'invoice_discount_value',
  'invoice_tax_name',
  'invoice_tax_rate',
]

/** Org tax rate preset (`documents.taxRates` setting, money MQ1 build spec §G.1). */
interface TaxRatePreset {
  id: string
  name: string
  rate: number
  isDefault?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// The builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One document-agnostic line builder: quote detail tab, job Line-items section
 * (M2), invoice detail + gather dialogs (MI1, `readOnly`). Fetches the parent
 * document's billing fields itself — consumers only pass the document handle.
 */
export function LineBuilder({
  documentRecordId,
  documentType,
  readOnly = false,
  visitId,
}: LineBuilderProps) {
  const docRecordId = documentRecordId as RecordId
  const { resource } = useResource(LINE_ITEM_SLUG)
  const entityDefinitionId = resource?.id
  const { getSetting } = useSettings({})
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'

  // work_order (M2 job view) has no billing fields (money MI1 build spec §J.2 precedent,
  // mirrored from TotalsFooter) — group discount/tax set-if-unset skips entirely there.
  const hasBilling = documentType === 'quote' || documentType === 'invoice'
  const billingPrefix = documentType === 'invoice' ? 'invoice' : 'quote'
  const { values: billingValues } = useSystemValues(
    docRecordId,
    documentType === 'invoice' ? INVOICE_BILLING_ATTRS : QUOTE_BILLING_ATTRS,
    { autoFetch: hasBilling, enabled: hasBilling }
  )
  const taxRates = ((getSetting('documents.taxRates') as TaxRatePreset[] | null) ?? []).filter(
    (r) => r && typeof r.rate === 'number'
  )

  const [orderOverride, setOrderOverride] = useState<string[] | null>(null)
  const [drafts, setDrafts] = useState<DraftLine[]>([])
  const draftsRef = useRef<DraftLine[]>([])
  draftsRef.current = drafts
  // Ref-guarded (not state-derived) so a synchronous double-commit can never
  // race two `record.create` calls for the same draft before React re-renders.
  const creatingDraftIdsRef = useRef<Set<string>>(new Set())

  // Baseline filter: lines belonging to this document, via the belongs_to rel
  // (`contact-tickets-tab.tsx` precedent — `operator: 'is'` + the RecordId;
  // the server strips the def prefix). Invoice mode ALSO excludes work-order source
  // lines stamped with `line_item_invoice` (the gather "invoiced by" pointer, money
  // MI1 build spec §B.3/§J.2) — only the invoice's own copies (workOrder empty) show.
  // work_order mode ALSO splits on `line_item_visitId` (plain-text bridge, dispatch lock):
  // a `visitId` prop → only that visit's occurrence extras; no prop → only the job's
  // per-cycle set (visitId empty), so extras never leak into the job Line-items tab.
  const filters = useMemo<ConditionGroup[]>(() => {
    if (documentType === 'invoice') {
      return [
        {
          id: 'line-builder-baseline',
          logicalOperator: 'AND',
          conditions: [
            {
              id: 'line-builder-document',
              fieldId: 'line_item:invoice',
              operator: 'is',
              value: documentRecordId,
            },
            {
              id: 'line-builder-invoice-workorder',
              fieldId: 'line_item:workOrder',
              operator: 'empty',
              value: null,
            },
          ],
        },
      ]
    }
    const conditions: ConditionGroup['conditions'] = [
      {
        id: 'line-builder-document',
        fieldId: documentType === 'quote' ? 'line_item:quote' : 'line_item:workOrder',
        operator: 'is',
        value: documentRecordId,
      },
    ]
    if (documentType === 'work_order') {
      conditions.push(
        visitId
          ? {
              id: 'line-builder-visit',
              fieldId: 'line_item:visitId',
              operator: 'is',
              value: visitId,
            }
          : {
              id: 'line-builder-visit',
              fieldId: 'line_item:visitId',
              operator: 'empty',
              value: null,
            }
      )
    }
    return [{ id: 'line-builder-baseline', logicalOperator: 'AND', conditions }]
  }, [documentType, documentRecordId, visitId])

  const {
    records,
    isLoading,
    isLoadingRecords,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    refresh,
    listKey,
  } = useRecordList<RecordMeta>({
    entityDefinitionId: entityDefinitionId ?? '',
    filters,
    sorting: LINE_SORT,
    limit: PAGE_SIZE,
    enabled: !!entityDefinitionId,
  })

  // No virtualized scroll anymore — load every page eagerly (line counts are small).
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isLoading) fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, isLoading, fetchNextPage])

  // Optimistic display order while a reorder mutation settles. Ids missing from
  // the override (freshly added lines) append in server order.
  const displayRecords = useMemo(() => {
    if (!orderOverride) return records
    const byId = new Map(records.map((r) => [r.id, r]))
    const overrideSet = new Set(orderOverride)
    const ordered = orderOverride
      .map((id) => byId.get(id))
      .filter((r): r is RecordMeta => r !== undefined)
    return [...ordered, ...records.filter((r) => !overrideSet.has(r.id))]
  }, [records, orderOverride])

  const displayIdsRef = useRef<string[]>([])
  displayIdsRef.current = displayRecords.map((r) => r.id)

  const lineRecordIds = useMemo(
    () =>
      entityDefinitionId ? displayRecords.map((r) => toRecordId(entityDefinitionId, r.id)) : [],
    [entityDefinitionId, displayRecords]
  )

  // Mutations (stable fns destructured — the wrapper objects churn per render).
  const reorderLines = api.money.reorderLines.useMutation()
  const recomputeTotals = api.money.recomputeTotals.useMutation()
  const deleteRecord = api.record.delete.useMutation()
  const deleteInvoiceLine = api.money.deleteInvoiceLine.useMutation()
  const createRecord = api.record.create.useMutation()
  const { mutate: reorderMutate } = reorderLines
  const { mutate: recomputeMutate } = recomputeTotals
  const { mutateAsync: deleteMutateAsync } = deleteRecord
  const { mutateAsync: deleteInvoiceLineMutateAsync } = deleteInvoiceLine
  const { mutateAsync: createMutateAsync } = createRecord

  const { saveMultipleAsync } = useSaveFieldValue()
  const { seedCreatedRecord } = useSeedCreatedRecord()

  const deleteLine = useCallback(
    async (lineId: string) => {
      if (!entityDefinitionId) return
      try {
        if (documentType === 'invoice') {
          // Unstamps the gathered source line + recomputes totals server-side
          // (money MI1 build spec §G.3) — NOT the quote's record.delete + recompute pair.
          await deleteInvoiceLineMutateAsync({
            lineRecordId: toRecordId(entityDefinitionId, lineId),
          })
        } else {
          await deleteMutateAsync({ recordId: toRecordId(entityDefinitionId, lineId) })
          // Deletes don't fire field-change hooks — recompute explicitly (§F.2).
          if (documentType === 'quote') recomputeMutate({ quoteRecordId: docRecordId })
        }
        refresh()
      } catch (error) {
        toastError({
          title: 'Error deleting line',
          description: error instanceof Error ? error.message : 'Could not delete the line',
        })
      }
    },
    [
      entityDefinitionId,
      documentType,
      docRecordId,
      deleteMutateAsync,
      deleteInvoiceLineMutateAsync,
      recomputeMutate,
      refresh,
    ]
  )

  /** Draft delete (trash icon) — local splice, no network. */
  const deleteDraft = useCallback((draftId: string) => {
    creatingDraftIdsRef.current.delete(draftId)
    setDrafts((prev) => prev.filter((d) => d.draftId !== draftId))
  }, [])

  /** "+ Add line item" — pushes a purely-local phantom draft. No mutation. */
  const addLine = useCallback(() => {
    setDrafts((prev) => [...prev, freshDraft(generateId())])
  }, [])

  /**
   * Fire the draft's first `record.create`, carrying every accumulated draft
   * value (merged with `overrides`, the field that just committed). Guarded
   * against double-create: once a draft is already creating, subsequent
   * commits just keep mutating local state — the in-flight create's
   * completion handler diffs + flushes them once it resolves.
   */
  const createDraft = useCallback(
    async (draftId: string, overrides: Partial<DraftLine> = {}) => {
      if (creatingDraftIdsRef.current.has(draftId)) {
        setDrafts((prev) => prev.map((d) => (d.draftId === draftId ? { ...d, ...overrides } : d)))
        return
      }

      const draftIndex = draftsRef.current.findIndex((d) => d.draftId === draftId)
      if (draftIndex === -1 || !entityDefinitionId) return
      const snapshot: DraftLine = {
        ...draftsRef.current[draftIndex],
        ...overrides,
        creating: true,
      }

      creatingDraftIdsRef.current.add(draftId)
      setDrafts((prev) => prev.map((d) => (d.draftId === draftId ? snapshot : d)))

      const relKey = relKeyForDocumentType(documentType)
      const values: Record<string, unknown> = {
        line_item_qty: snapshot.qty,
        line_item_taxable: snapshot.taxable,
        line_item_sort_order: displayIdsRef.current.length + draftIndex,
        [relKey]: documentRecordId,
      }
      if (visitId) values.line_item_visit_id = visitId
      if (snapshot.name) values.line_item_name = snapshot.name
      if (snapshot.description) values.line_item_description = snapshot.description
      if (snapshot.category) values.line_item_category = snapshot.category
      if (snapshot.unitPriceCents !== null) values.line_item_unit_price = snapshot.unitPriceCents
      if (snapshot.catalogItemRecordId) {
        values.line_item_catalog_item = snapshot.catalogItemRecordId
      }

      try {
        const result = await createMutateAsync({ entityDefinitionId: 'line_item', values })

        seedCreatedRecord({
          entityDefinitionId,
          recordId: result.recordId,
          listKey,
          instance: result.instance,
          values: [
            { fieldId: 'line_item_name', value: snapshot.name, fieldType: FieldType.TEXT },
            {
              fieldId: 'line_item_description',
              value: snapshot.description,
              fieldType: FieldType.TEXT,
            },
            {
              fieldId: 'line_item_category',
              value: snapshot.category,
              fieldType: FieldType.SINGLE_SELECT,
            },
            { fieldId: 'line_item_qty', value: snapshot.qty, fieldType: FieldType.NUMBER },
            {
              fieldId: 'line_item_unit_price',
              value: snapshot.unitPriceCents,
              fieldType: FieldType.CURRENCY,
            },
            {
              fieldId: 'line_item_taxable',
              value: snapshot.taxable,
              fieldType: FieldType.CHECKBOX,
            },
          ],
        })

        // Diff whatever landed locally while the create was in flight, and
        // flush just the changed fields against the now-real record.
        const latest = draftsRef.current.find((d) => d.draftId === draftId) ?? snapshot
        const changed: Array<{ fieldId: string; value: unknown; fieldType: FieldType }> = []
        if (latest.name !== snapshot.name) {
          changed.push({
            fieldId: 'line_item_name',
            value: latest.name,
            fieldType: FieldType.TEXT,
          })
        }
        if (latest.description !== snapshot.description) {
          changed.push({
            fieldId: 'line_item_description',
            value: latest.description,
            fieldType: FieldType.TEXT,
          })
        }
        if (latest.category !== snapshot.category) {
          changed.push({
            fieldId: 'line_item_category',
            value: latest.category,
            fieldType: FieldType.SINGLE_SELECT,
          })
        }
        if (latest.taxable !== snapshot.taxable) {
          changed.push({
            fieldId: 'line_item_taxable',
            value: latest.taxable,
            fieldType: FieldType.CHECKBOX,
          })
        }
        if (latest.qty !== snapshot.qty) {
          changed.push({
            fieldId: 'line_item_qty',
            value: latest.qty,
            fieldType: FieldType.NUMBER,
          })
        }
        if (latest.unitPriceCents !== snapshot.unitPriceCents) {
          changed.push({
            fieldId: 'line_item_unit_price',
            value: latest.unitPriceCents,
            fieldType: FieldType.CURRENCY,
          })
        }
        if (latest.catalogItemRecordId !== snapshot.catalogItemRecordId) {
          changed.push({
            fieldId: 'line_item_catalog_item',
            value: latest.catalogItemRecordId,
            fieldType: FieldType.RELATIONSHIP,
          })
        }
        if (changed.length > 0) {
          await saveMultipleAsync(result.recordId, changed)
        }

        creatingDraftIdsRef.current.delete(draftId)
        setDrafts((prev) => prev.filter((d) => d.draftId !== draftId))
      } catch (error) {
        creatingDraftIdsRef.current.delete(draftId)
        setDrafts((prev) =>
          prev.map((d) => (d.draftId === draftId ? { ...d, creating: false } : d))
        )
        toastError({
          title: 'Error adding line',
          description: error instanceof Error ? error.message : 'Could not add the line',
        })
      }
    },
    [
      entityDefinitionId,
      documentType,
      documentRecordId,
      visitId,
      createMutateAsync,
      saveMultipleAsync,
      seedCreatedRecord,
      listKey,
    ]
  )

  /**
   * Steps 2 (append entries 2…N) + 4–5 (document discount/tax set-if-unset)
   * of a catalog-group explode (money 09-product-groups.md "Line-builder
   * consumption") — shared by the real-row and draft-row group-pick paths.
   * `baseOrder` is the sort order the first of `rest` should land at.
   */
  const applyGroupPickRestAndBilling = useCallback(
    async (pick: CatalogGroupPick, rest: CatalogGroupPickLine[], baseOrder: number) => {
      if (rest.length > 0) {
        const relKey = relKeyForDocumentType(documentType)
        try {
          for (const [index, line] of rest.entries()) {
            await createMutateAsync({
              entityDefinitionId: 'line_item',
              values: {
                line_item_name: line.name,
                line_item_description: line.description,
                line_item_category: line.category,
                line_item_taxable: line.taxable,
                line_item_unit_price: line.unitPrice,
                line_item_qty: line.qty,
                line_item_catalog_item: toRecordId('catalog_item', line.catalogItemId),
                line_item_sort_order: baseOrder + index,
                [relKey]: documentRecordId,
                ...(visitId ? { line_item_visit_id: visitId } : {}),
              },
            })
          }
        } catch (error) {
          toastError({
            title: 'Error adding group lines',
            description: error instanceof Error ? error.message : 'Could not add all group lines',
          })
        }
        refresh()
      }

      // Steps 4–5: document discount/tax set-if-unset — quote/invoice only, never
      // overwriting a value the document already has.
      if (hasBilling) {
        const currentDiscountValue = billingValues[`${billingPrefix}_discount_value`] as
          | number
          | null
          | undefined
        if (pick.discountType && pick.discountValue !== null && currentDiscountValue == null) {
          void saveMultipleAsync(docRecordId, [
            {
              fieldId: `${billingPrefix}_discount_type`,
              value: pick.discountType,
              fieldType: FieldType.SINGLE_SELECT,
            },
            {
              fieldId: `${billingPrefix}_discount_value`,
              value: pick.discountValue,
              fieldType: FieldType.NUMBER,
            },
          ])
        }

        const currentTaxRate = billingValues[`${billingPrefix}_tax_rate`] as
          | number
          | null
          | undefined
        if (pick.taxRateId && currentTaxRate == null) {
          // A deleted preset id silently no-ops — no tax write.
          const preset = taxRates.find((r) => r.id === pick.taxRateId)
          if (preset) {
            void saveMultipleAsync(docRecordId, [
              {
                fieldId: `${billingPrefix}_tax_name`,
                value: preset.name,
                fieldType: FieldType.TEXT,
              },
              {
                fieldId: `${billingPrefix}_tax_rate`,
                value: preset.rate,
                fieldType: FieldType.NUMBER,
              },
            ])
          }
        }
      }
    },
    [
      documentType,
      documentRecordId,
      docRecordId,
      visitId,
      hasBilling,
      billingPrefix,
      billingValues,
      taxRates,
      saveMultipleAsync,
      createMutateAsync,
      refresh,
    ]
  )

  /**
   * Explode a picked catalog group onto a REAL line (money 09-product-groups.md
   * "Line-builder consumption"): entry #1 fills the line whose picker was open,
   * entries 2…N append as new lines via {@link applyGroupPickRestAndBilling}.
   */
  const handleGroupPick = useCallback(
    async (recordId: RecordId, pick: CatalogGroupPick) => {
      if (pick.skippedCount > 0) {
        console.warn(`Catalog group "${pick.name}" skipped ${pick.skippedCount} dangling item(s).`)
      }
      if (pick.lines.length === 0) return

      const [first, ...rest] = pick.lines

      // Step 1: entry #1 fills the CURRENT line — the handlePick shape (catalog-picker.tsx)
      // plus qty, which the single-item pick leaves untouched.
      void saveMultipleAsync(recordId, [
        { fieldId: 'line_item_name', value: first.name, fieldType: FieldType.TEXT },
        { fieldId: 'line_item_description', value: first.description, fieldType: FieldType.TEXT },
        {
          fieldId: 'line_item_category',
          value: first.category,
          fieldType: FieldType.SINGLE_SELECT,
        },
        { fieldId: 'line_item_taxable', value: first.taxable, fieldType: FieldType.CHECKBOX },
        { fieldId: 'line_item_unit_price', value: first.unitPrice, fieldType: FieldType.CURRENCY },
        { fieldId: 'line_item_qty', value: first.qty, fieldType: FieldType.NUMBER },
        {
          fieldId: 'line_item_catalog_item',
          value: toRecordId('catalog_item', first.catalogItemId),
          fieldType: FieldType.RELATIONSHIP,
        },
      ])

      // Known v1 edge: picking on a middle line still appends `rest` at the list end.
      await applyGroupPickRestAndBilling(pick, rest, displayIdsRef.current.length)
    },
    [saveMultipleAsync, applyGroupPickRestAndBilling]
  )

  /** Same explode intent as {@link handleGroupPick}, targeting a phantom draft. */
  const handleGroupPickDraft = useCallback(
    async (draftId: string, pick: CatalogGroupPick) => {
      if (pick.skippedCount > 0) {
        console.warn(`Catalog group "${pick.name}" skipped ${pick.skippedCount} dangling item(s).`)
      }
      if (pick.lines.length === 0) return

      const [first, ...rest] = pick.lines

      // Step 1: entry #1's values become THIS draft's create.
      void createDraft(draftId, {
        name: first.name,
        description: first.description,
        category: first.category,
        taxable: first.taxable,
        unitPriceCents: first.unitPrice,
        qty: first.qty,
        catalogItemRecordId: toRecordId('catalog_item', first.catalogItemId),
      })

      // Real records + every current draft occupy a sort-order slot ahead of `rest`.
      const baseOrder = displayIdsRef.current.length + draftsRef.current.length
      await applyGroupPickRestAndBilling(pick, rest, baseOrder)
    },
    [createDraft, applyGroupPickRestAndBilling]
  )

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!entityDefinitionId || !over || active.id === over.id) return
      const current = displayIdsRef.current
      const oldIndex = current.indexOf(String(active.id))
      const newIndex = current.indexOf(String(over.id))
      if (oldIndex === -1 || newIndex === -1) return

      const nextOrder = arrayMove(current, oldIndex, newIndex)
      setOrderOverride(nextOrder)
      reorderMutate(
        {
          documentRecordId: docRecordId,
          orderedLineRecordIds: nextOrder.map((id) => toRecordId(entityDefinitionId, id)),
        },
        {
          onError: (error) => {
            setOrderOverride(null)
            refresh()
            toastError({ title: 'Error reordering lines', description: error.message })
          },
        }
      )
    },
    [entityDefinitionId, docRecordId, reorderMutate, refresh]
  )

  if (!entityDefinitionId) return null

  const isEmpty =
    !isLoading && !isLoadingRecords && displayRecords.length === 0 && drafts.length === 0

  return (
    <div className='flex min-h-0 flex-1 flex-col overflow-y-auto rounded-lg'>
      {/* Header — same grid template as the rows, so the labels sit over their columns.
          The Description label offsets past the row px-1 + grip slot + title/button padding. */}
      <div
        className='sticky top-0 z-10 grid border-primary-200/50 border-b bg-primary-50 px-1 pb-1 text-muted-foreground text-xs dark:border-[#1e2227] dark:bg-background'
        style={{ gridTemplateColumns: readOnly ? LINE_COLS_READONLY : LINE_COLS }}>
        <div className={readOnly ? 'pl-2' : 'pl-9'}>Description</div>
        <div className='px-2 text-right'>Qty</div>
        <div className='px-2 text-right'>Unit cost</div>
        <div className='px-2 text-right'>Total</div>
        {!readOnly && <div />}
      </div>

      {isEmpty && readOnly ? (
        <EmptyState icon={ReceiptText} title='No line items' />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          modifiers={[restrictToVerticalAxis]}>
          <SortableContext
            items={displayIdsRef.current}
            strategy={verticalListSortingStrategy}
            disabled={readOnly}>
            {displayRecords.map((record) => (
              <LineRow
                key={record.id}
                record={record}
                entityDefinitionId={entityDefinitionId}
                readOnly={readOnly}
                currencyCode={currencyCode}
                deleteLine={deleteLine}
                onSelectGroup={handleGroupPick}
              />
            ))}
          </SortableContext>
        </DndContext>
      )}

      {/* Phantom draft rows — pinned after the real rows, never drag-sortable. */}
      {!readOnly &&
        drafts.map((draft) => (
          <DraftLineRow
            key={draft.draftId}
            draft={draft}
            currencyCode={currencyCode}
            deleteDraft={deleteDraft}
            createDraft={createDraft}
            onSelectGroup={handleGroupPickDraft}
          />
        ))}

      {!readOnly && (
        <div className='border-primary-200/50 border-b px-1 py-0.5 dark:border-[#1e2227]'>
          <Button variant='ghost' size='sm' className='text-muted-foreground' onClick={addLine}>
            <Plus />
            Add line item
          </Button>
        </div>
      )}

      <TotalsFooter
        documentRecordId={docRecordId}
        documentType={documentType}
        readOnly={readOnly}
        currencyCode={currencyCode}
        lineRecordIds={lineRecordIds}
      />
    </div>
  )
}
