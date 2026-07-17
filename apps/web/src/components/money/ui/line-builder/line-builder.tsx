// apps/web/src/components/money/ui/line-builder/line-builder.tsx

'use client'

// The document-agnostic line-items builder (money MQ1 build spec §H.1, 01-ui.md #1).
// Lines render as plain `group/tree-row` grid rows under a matching grid header
// (Description / Qty / Rate / Total): one shared
// `grid-template-columns` keeps the number columns aligned across the header and
// every row. Line counts are small, so plain rows replace the virtualized
// `DynamicView` embed this used to be. Row/cell markup lives in `line-rows.tsx`;
// this file owns state, data fetching, and mutations.
//
// Keyboard: the rows sit in a container wired to `useLineNav` — spreadsheet-style
// focus movement across name → qty → rate, where Enter / ArrowDown / Tab
// past the last row spawns a fresh draft (`addLine`). The name cell is free-text;
// `/` on an empty cell opens the catalog picker.
//
// Data flow:
// - `LineBuilder` preloads the displayed line-id × field matrix once through
//   `useFieldValueSyncer`; each `LineRow` keeps one passive store subscription.
// - Cells emit semantic patches to the builder's single `useSaveFieldValue`
//   owner. Optimistic store writes repaint rows/totals immediately; the
//   server-side field-change hooks (§F.2) recompute lineTotal + quote totals
//   and publish via realtime back into the same store.
// - Totals footer: pure client math via `computeDocumentTotals` /
//   `computeLineTotal` from `@auxx/lib/money/client` over store values — the
//   same function the server hook uses, so the optimistic footer and the
//   stored mirrors can never disagree.
// - Add: pushes a purely-local "phantom draft" row (`DraftLine`, line-rows.tsx)
//   — no mutation, no round-trip — with its name cell auto-focused. The
//   record is only created on the draft's first real commit (catalog pick,
//   free-text name, description, qty/price blur, taxable toggle, or a
//   catalog-group pick), carrying every value accumulated on the draft in one
//   `record.create` call. The create result seeds the record + field-value
//   caches directly (`useSeedCreatedRecord`) — no `refresh()` — and the draft
//   is swapped for the now-real row. Edits that land while the create is in
//   flight keep mutating local draft state; once it resolves, anything that
//   changed since the snapshot was sent is flushed via `saveMultipleAsync`
//   against the real record. An untouched draft simply vanishes on unmount.
//   An editable builder initially seeds three of these drafts as local loading
//   placeholders. If persisted rows arrive, they replace only those initial
//   drafts; they still follow the same no-save-until-edited rule.
// - Group explode: a catalog-group pick fills the picked line (entry #1) and
//   pushes entries 2…N as pre-filled phantom drafts in the same frame, then
//   materializes them through the same createDraft → seed pipeline — the
//   bundle is fully visible (and totaled) before any create resolves, and no
//   row ever shifts position while the creates land.
// - Reorder: dnd-kit sortable rows (grip handle) → `api.money.reorderLines`.
//   Draft rows aren't part of the sortable set — they pin after the real rows.
// - Delete: real rows → `api.record.delete` + `api.money.recomputeTotals`
//   (delete path doesn't fire field-change hooks, §F.2). Draft rows → local
//   splice, no network.

import { FieldType } from '@auxx/database/enums'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { Button } from '@auxx/ui/components/button'
import { EmptySection } from '@auxx/ui/components/section'
import { toastError } from '@auxx/ui/components/toast'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'
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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CatalogGroup } from '~/components/money/hooks/use-catalog-groups'
import { useCatalogGroups } from '~/components/money/hooks/use-catalog-groups'
import { useCatalogItems } from '~/components/money/hooks/use-catalog-items'
import {
  type RecordId,
  type RecordMeta,
  toRecordId,
  useRecordList,
  useResource,
  useResourceFields,
} from '~/components/resources'
import { useFieldValueSyncer } from '~/components/resources/hooks/use-field-value-syncer'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { useSeedCreatedRecord } from '~/components/resources/hooks/use-seed-created-record'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { useResourceStore } from '~/components/resources/store/resource-store'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'
import { type ResolvedCatalogGroup, resolveCatalogGroup } from './catalog-group-resolver'
import {
  type CategoryOption,
  type DraftLine,
  DraftLineRow,
  freshDraft,
  LINE_COLS,
  LineRow,
  relKeyForDocumentType,
} from './line-rows'
import {
  BASE_LINE_SYSTEM_ATTRIBUTES,
  diffLineValues,
  type LinePatch,
  type LineValues,
  linePatchToFieldValues,
  QUOTE_LINE_SYSTEM_ATTRIBUTES,
} from './line-values'
import { TotalsFooter } from './totals-footer'
import { useLineHotkeys } from './use-line-hotkeys'
import { useLineNav } from './use-line-nav'

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
  /** Extra classes merged onto the builder's scroll-container root. */
  className?: string
}

const LINE_ITEM_SLUG = 'line-items'
const PAGE_SIZE = 100
const INITIAL_DRAFT_COUNT = 3
/** Stable sort ref — `useRecordList` keys its cache off this object. */
const LINE_SORT = [{ id: 'sortOrder', desc: false }]
/** Every fixed line-builder field is visible to the shared syncer. */
const LINE_FIELD_VISIBILITY = {}

// Document billing mirrors read once for group set-if-unset checks and `TotalsFooter`.
// Invoice mode also carries its read-only paid/balance ledger mirrors.
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
  'invoice_amount_paid',
  'invoice_balance',
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
  className,
}: LineBuilderProps) {
  const docRecordId = documentRecordId as RecordId
  const { resource } = useResource(LINE_ITEM_SLUG)
  const entityDefinitionId = resource?.id
  // Category options come from the field definition (not a hardcoded list) so
  // org-added categories appear in the badge dropdown with their own colors.
  const { fields: lineItemFields } = useResourceFields(LINE_ITEM_SLUG)
  const categoryOptions = useMemo<CategoryOption[]>(() => {
    const field = lineItemFields.find((f) => f.key === 'category')
    return (field?.options?.options ?? []).map((o) => ({
      value: o.value,
      label: o.label,
      color: o.color,
    }))
  }, [lineItemFields])
  // Catalog data is shared by every row picker. Editable builders preload it
  // once so opening a picker or resolving a product group never starts a fetch.
  const catalogEnabled = !!entityDefinitionId && !readOnly
  const {
    items: catalogItems,
    itemMap: catalogItemMap,
    isLoading: catalogItemsLoading,
  } = useCatalogItems({ enabled: catalogEnabled })
  const { groups: catalogGroups, isLoading: catalogGroupsLoading } = useCatalogGroups({
    enabled: catalogEnabled,
  })
  const catalogLoading = catalogItemsLoading || catalogGroupsLoading
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
  const taxRates = useMemo(
    () =>
      ((getSetting('documents.taxRates') as TaxRatePreset[] | null) ?? []).filter(
        (rate) => rate && typeof rate.rate === 'number'
      ),
    [getSetting]
  )

  const [orderOverride, setOrderOverride] = useState<string[] | null>(null)
  const [drafts, setDrafts] = useState<DraftLine[]>([])
  // Id of the most recently added draft — its name cell auto-focuses on mount so
  // a keyboard-driven or button-driven "add row" lands the caret ready to type.
  const [lastAddedDraftId, setLastAddedDraftId] = useState<string | null>(null)
  const draftsRef = useRef<DraftLine[]>([])
  draftsRef.current = drafts
  // An editable document starts with a small working set of local-only rows.
  // Track just these initial rows so persisted records can replace them without
  // hiding drafts the user explicitly added later.
  const seededInitialDraftsRef = useRef(false)
  const initialDraftIdsRef = useRef<Set<string>>(new Set())
  /** Rows container — the keydown listener {@link useLineNav} attaches to. */
  const rowsContainerRef = useRef<HTMLDivElement>(null)
  // Last focused line cell (row/col + caret). Committing a draft fires a
  // `record.create` whose completion swaps `DraftLineRow` → `LineRow`, replacing
  // the row's input elements and dropping focus to `<body>`. We snapshot the
  // focused cell here and restore it after that swap so keyboard flow survives
  // materialization (otherwise the next Tab escapes the grid entirely).
  const focusedCellRef = useRef<{ row: number; col: number; caret: number | null } | null>(null)

  const rememberFocusedCell = useCallback(() => {
    const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
    const cell = el?.closest?.('[data-line-row][data-line-col]') as HTMLElement | null
    if (!cell || !rowsContainerRef.current?.contains(cell)) return
    focusedCellRef.current = {
      row: Number(cell.dataset.lineRow),
      col: Number(cell.dataset.lineCol),
      caret: typeof el?.selectionStart === 'number' ? el.selectionStart : null,
    }
  }, [])
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

  // Seed local loading placeholders immediately. Persisted rows replace these
  // exact drafts below; manually added drafts are never part of this set.
  useEffect(() => {
    if (
      !entityDefinitionId ||
      readOnly ||
      seededInitialDraftsRef.current ||
      displayRecords.length > 0 ||
      draftsRef.current.length > 0
    ) {
      return
    }

    seededInitialDraftsRef.current = true
    const initialDrafts = Array.from({ length: INITIAL_DRAFT_COUNT }, () =>
      freshDraft(generateId())
    )
    initialDraftIdsRef.current = new Set(initialDrafts.map((draft) => draft.draftId))
    setDrafts(initialDrafts)
    setLastAddedDraftId(initialDrafts[0]?.draftId ?? null)
  }, [entityDefinitionId, readOnly, displayRecords.length])

  // When persisted lines arrive, hide/remove the initial loading placeholders
  // in the same render. A draft becomes non-placeholder before its first
  // `record.create`, so a user edit is never discarded by this cleanup.
  const visibleDrafts = useMemo(() => {
    if (displayRecords.length === 0) return drafts
    return drafts.filter((draft) => !initialDraftIdsRef.current.has(draft.draftId))
  }, [displayRecords.length, drafts])

  useEffect(() => {
    if (displayRecords.length === 0 || initialDraftIdsRef.current.size === 0) return
    const initialDraftIds = initialDraftIdsRef.current
    initialDraftIdsRef.current = new Set()
    setDrafts((current) => current.filter((draft) => !initialDraftIds.has(draft.draftId)))
    setLastAddedDraftId((current) => (current && initialDraftIds.has(current) ? null : current))
  }, [displayRecords.length])

  const lineRecordIds = useMemo(
    () =>
      entityDefinitionId ? displayRecords.map((r) => toRecordId(entityDefinitionId, r.id)) : [],
    [entityDefinitionId, displayRecords]
  )

  // Match records-view's fetch ownership: queue the complete displayed
  // record-id × line-field matrix once, while rows subscribe passively.
  const systemAttributeMap = useResourceStore((state) => state.systemAttributeMap)
  const lineFieldIds = useMemo(() => {
    const attributes =
      documentType === 'quote' ? QUOTE_LINE_SYSTEM_ATTRIBUTES : BASE_LINE_SYSTEM_ATTRIBUTES
    return attributes
      .map((attribute) => systemAttributeMap[attribute])
      .filter((fieldId): fieldId is NonNullable<typeof fieldId> => !!fieldId)
  }, [documentType, systemAttributeMap])
  useFieldValueSyncer({
    recordIds: lineRecordIds,
    columnVisibility: LINE_FIELD_VISIBILITY,
    resourceFieldIds: lineFieldIds,
    enabled: lineRecordIds.length > 0 && lineFieldIds.length > 0,
  })

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

  const { saveFieldValue, saveMultipleAsync } = useSaveFieldValue()
  const { seedCreatedRecord } = useSeedCreatedRecord()

  /** Persist one semantic line patch through the single optimistic save owner. */
  const updateLine = useCallback(
    (recordId: RecordId, patch: LinePatch) => {
      const updates = linePatchToFieldValues(patch)
      if (updates.length === 0) return
      if (updates.length === 1) {
        const update = updates[0]
        if (!update) return
        saveFieldValue(recordId, update.fieldId, update.value, update.fieldType)
        return
      }
      void saveMultipleAsync(recordId, updates)
    },
    [saveFieldValue, saveMultipleAsync]
  )

  const updateDiscount = useCallback(
    (type: 'percent' | 'amount' | null, value: number | null) => {
      if (!hasBilling) return
      void saveMultipleAsync(docRecordId, [
        {
          fieldId: `${billingPrefix}_discount_type`,
          value: type,
          fieldType: FieldType.SINGLE_SELECT,
        },
        {
          fieldId: `${billingPrefix}_discount_value`,
          value,
          fieldType: FieldType.NUMBER,
        },
      ])
    },
    [hasBilling, saveMultipleAsync, docRecordId, billingPrefix]
  )

  const updateTax = useCallback(
    (name: string | null, rate: number | null) => {
      if (!hasBilling) return
      void saveMultipleAsync(docRecordId, [
        { fieldId: `${billingPrefix}_tax_name`, value: name, fieldType: FieldType.TEXT },
        { fieldId: `${billingPrefix}_tax_rate`, value: rate, fieldType: FieldType.NUMBER },
      ])
    },
    [hasBilling, saveMultipleAsync, docRecordId, billingPrefix]
  )

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
    initialDraftIdsRef.current.delete(draftId)
    setDrafts((prev) => prev.filter((d) => d.draftId !== draftId))
  }, [])

  /**
   * "+ Add line item" (and keyboard nav past the last row) — pushes a
   * purely-local phantom draft and marks it as the one to auto-focus. No mutation.
   */
  const addLine = useCallback(() => {
    const draft = freshDraft(generateId())
    setLastAddedDraftId(draft.draftId)
    setDrafts((prev) => [...prev, draft])
  }, [])

  /**
   * Fire the draft's first `record.create`, carrying every accumulated draft
   * value (merged with `overrides`, the field that just committed). Guarded
   * against double-create: once a draft is already creating, subsequent
   * commits just keep mutating local state — the in-flight create's
   * completion handler diffs + flushes them once it resolves.
   */
  const createDraft = useCallback(
    async (draftId: string, overrides: LinePatch = {}) => {
      // The first real edit promotes an initial loading placeholder to a normal
      // draft, so an arriving persisted list cannot remove the user's work.
      initialDraftIdsRef.current.delete(draftId)
      if (creatingDraftIdsRef.current.has(draftId)) {
        setDrafts((prev) => prev.map((d) => (d.draftId === draftId ? { ...d, ...overrides } : d)))
        return
      }

      const draftIndex = draftsRef.current.findIndex((d) => d.draftId === draftId)
      const currentDraft = draftsRef.current[draftIndex]
      if (!currentDraft || !entityDefinitionId) return
      const snapshot: DraftLine = {
        ...currentDraft,
        ...overrides,
        creating: true,
      }

      creatingDraftIdsRef.current.add(draftId)
      setDrafts((prev) => prev.map((d) => (d.draftId === draftId ? snapshot : d)))

      const relKey = relKeyForDocumentType(documentType)
      const values: Record<string, unknown> = {
        line_item_qty: snapshot.qty,
        line_item_unit: snapshot.unit,
        line_item_taxable: snapshot.taxable,
        line_item_optional: snapshot.optional,
        line_item_optional_selected: snapshot.optionalSelected,
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
          values: linePatchToFieldValues(snapshot),
        })

        // Diff whatever landed locally while the create was in flight, and
        // flush just the changed fields against the now-real record.
        const latest = draftsRef.current.find((d) => d.draftId === draftId) ?? snapshot
        const changed = linePatchToFieldValues(diffLineValues(snapshot, latest))
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
   * Entries 2…N land as pre-filled phantom drafts IMMEDIATELY — instant
   * paint, and totals are right on the first frame (`TotalsFooter` already
   * folds drafts into its math). They then materialize through the normal
   * `createDraft` → `seedCreatedRecord` pipeline, each draft swapping in
   * place for its real row with zero refetch — no `refresh()`, so the list
   * never reshuffles mid-explode. Creates run sequentially: the list cache
   * appends in completion order, so completion order must equal draft order
   * to agree with the `line_item_sort_order` stamps (freshDraft's
   * optional=false / optionalSelected=true defaults are exactly the
   * "group-exploded lines start required" rule, money plan 18 §3).
   */
  const applyGroupPickRestAndBilling = useCallback(
    (pick: ResolvedCatalogGroup, rest: LineValues[]) => {
      if (rest.length > 0) {
        const bundleDrafts: DraftLine[] = rest.map((line) => ({
          ...freshDraft(generateId()),
          ...line,
        }))
        // Write through draftsRef (normally render-synced) so the sequential
        // createDraft calls below can resolve these drafts before React
        // re-renders; per-line failures keep the draft editable + toast
        // inside createDraft, so there's no explode-level error handling.
        draftsRef.current = [...draftsRef.current, ...bundleDrafts]
        setDrafts(draftsRef.current)
        void (async () => {
          for (const draft of bundleDrafts) {
            await createDraft(draft.draftId)
          }
        })()
      }

      // Steps 4–5: document discount/tax set-if-unset — quote/invoice only, never
      // overwriting a value the document already has.
      if (hasBilling) {
        const currentDiscountValue = billingValues[`${billingPrefix}_discount_value`] as
          | number
          | null
          | undefined
        if (pick.discountType && pick.discountValue !== null && currentDiscountValue == null) {
          updateDiscount(pick.discountType, pick.discountValue)
        }

        const currentTaxRate = billingValues[`${billingPrefix}_tax_rate`] as
          | number
          | null
          | undefined
        if (pick.taxRateId && currentTaxRate == null) {
          // A deleted preset id silently no-ops — no tax write.
          const preset = taxRates.find((r) => r.id === pick.taxRateId)
          if (preset) updateTax(preset.name, preset.rate)
        }
      }
    },
    [hasBilling, billingPrefix, billingValues, taxRates, updateDiscount, updateTax, createDraft]
  )

  /**
   * Explode a picked catalog group onto a REAL line (money 09-product-groups.md
   * "Line-builder consumption"): entry #1 fills the line whose picker was open,
   * entries 2…N append as new lines via {@link applyGroupPickRestAndBilling}.
   */
  const handleGroupPick = useCallback(
    (recordId: RecordId, group: CatalogGroup) => {
      const pick = resolveCatalogGroup(group, catalogItemMap)
      if (pick.skippedCount > 0) {
        console.warn(`Catalog group "${pick.name}" skipped ${pick.skippedCount} dangling item(s).`)
      }
      if (pick.lines.length === 0) return

      const [first, ...rest] = pick.lines
      if (!first) return

      // Step 1: entry #1 fills the CURRENT line — the handlePick shape (catalog-picker.tsx)
      // plus qty, which the single-item pick leaves untouched. Resets optional/optionalSelected
      // to required (money plan 18 §3) — same "pick overwrites the line's identity" precedent
      // as taxable already follows.
      updateLine(recordId, first)

      // Known v1 edge: picking on a middle line still appends `rest` at the list end.
      applyGroupPickRestAndBilling(pick, rest)
    },
    [catalogItemMap, updateLine, applyGroupPickRestAndBilling]
  )

  /** Same explode intent as {@link handleGroupPick}, targeting a phantom draft. */
  const handleGroupPickDraft = useCallback(
    (draftId: string, group: CatalogGroup) => {
      const pick = resolveCatalogGroup(group, catalogItemMap)
      if (pick.skippedCount > 0) {
        console.warn(`Catalog group "${pick.name}" skipped ${pick.skippedCount} dangling item(s).`)
      }
      if (pick.lines.length === 0) return

      const [first, ...rest] = pick.lines
      if (!first) return

      // Step 1: entry #1's values become THIS draft's create. Catalog/group-exploded
      // lines start required (money plan 18 §3).
      void createDraft(draftId, first)

      applyGroupPickRestAndBilling(pick, rest)
    },
    [catalogItemMap, createDraft, applyGroupPickRestAndBilling]
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

  // Spreadsheet keyboard nav across the rows container (name → qty → rate);
  // Enter / ArrowDown / Tab past the last row calls `addLine` to spawn a draft.
  useLineNav({
    containerRef: rowsContainerRef,
    rowCount: displayRecords.length + visibleDrafts.length,
    colCount: 3,
    onAddRow: addLine,
    readOnly,
  })

  // Row-action shortcuts (description / category / optional / taxable / delete)
  // on the same container — resolved to whichever row holds focus.
  useLineHotkeys({
    containerRef: rowsContainerRef,
    isQuote: documentType === 'quote',
    readOnly,
  })

  // Restore focus after a draft→real swap: when materialization detaches the
  // focused input, the browser parks focus on `<body>`. Only then (never when the
  // user intentionally clicked elsewhere) do we re-focus the same cell index.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on any row-set change (records/drafts)
  useLayoutEffect(() => {
    const target = focusedCellRef.current
    if (!target || document.activeElement !== document.body) return
    const sel = `[data-line-row="${target.row}"][data-line-col="${target.col}"]`
    // The name cell rests as a `[data-cell-focusable]` text button (no <input>
    // until focused), so match that too — otherwise focus is lost after a
    // draft→real swap on the name column.
    const input = rowsContainerRef.current?.querySelector(
      `${sel} input, ${sel} textarea, ${sel} [data-cell-focusable]`
    ) as HTMLElement | null
    if (!input) return
    input.focus()
    if (target.caret != null && 'setSelectionRange' in input) {
      try {
        ;(input as HTMLInputElement).setSelectionRange(target.caret, target.caret)
      } catch {
        // Non-text inputs reject setSelectionRange — focus alone is enough.
      }
    }
  }, [records, drafts])

  if (!entityDefinitionId) return null

  const isEmpty =
    !isLoading && !isLoadingRecords && displayRecords.length === 0 && visibleDrafts.length === 0

  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col  rounded-lg',
        // Left gutter so the drag grip can sit outside the framed box (grips
        // absolutely position into this space at `-left-4`).
        // !readOnly && 'pl-4',
        className
      )}>
      {/* Header + rows share one bordered box, so the grid reads as a single
          framed table. Totals sit outside the frame, below. The `data-slot` lets a
          parent (e.g. `TuckedSection`) override the frame's radius/border/ring. */}
      <div
        data-slot='line-builder-frame'
        className='rounded-lg border border-primary-200/50 dark:border-[#1e2227]'>
        {/* Header — same grid template as the rows, so the labels sit over their columns.
            The grip lives in the gutter now, so Description starts flush (pl-2). */}
        <div
          className='sticky top-0 z-10 grid rounded-t-lg border-primary-200/50 border-b bg-primary-50 px-1 py-2 text-muted-foreground text-sm dark:border-[#1e2227] dark:bg-background'
          style={{ gridTemplateColumns: LINE_COLS }}>
          <div className='flex items-center gap-1 pl-2'>
            Description
            {!readOnly && (
              <SimpleTooltip content='Add line item' side='right'>
                <Button
                  variant='ghost'
                  size='icon-xs'
                  className='ml-1 size-5 rounded-md bg-primary-100 hover:bg-primary-200 dark:bg-background'
                  onClick={addLine}
                  aria-label='Add line item'>
                  <Plus className='size-3' />
                </Button>
              </SimpleTooltip>
            )}
          </div>
          <div className='px-2 text-right'>Qty</div>
          <div className='px-2 text-right'>Rate</div>
          <div className='px-2 text-right'>Total</div>
        </div>

        {/* Rows container — the keydown listener for spreadsheet nav lives here, so
            real rows and phantom drafts share one continuous focus index space.
            The capture handlers keep `focusedCellRef` fresh for post-swap restore. */}
        <div
          ref={rowsContainerRef}
          onFocusCapture={rememberFocusedCell}
          onKeyUpCapture={rememberFocusedCell}
          onPointerUpCapture={rememberFocusedCell}>
          {isEmpty && readOnly ? (
            <EmptySection
              className='border-transparent ring-0'
              icon={<ReceiptText className='size-5' />}
              title='No line items'
            />
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
                {displayRecords.map((record, index) => (
                  <LineRow
                    key={record.id}
                    record={record}
                    rowIndex={index}
                    entityDefinitionId={entityDefinitionId}
                    categoryOptions={categoryOptions}
                    readOnly={readOnly}
                    currencyCode={currencyCode}
                    documentType={documentType}
                    catalogItems={catalogItems}
                    catalogGroups={catalogGroups}
                    catalogItemMap={catalogItemMap}
                    catalogLoading={catalogLoading}
                    onUpdateLine={updateLine}
                    deleteLine={deleteLine}
                    onSelectGroup={handleGroupPick}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}

          {/* Phantom draft rows — pinned after the real rows, never drag-sortable.
              They continue the nav index space (real count + draft index). */}
          {!readOnly &&
            visibleDrafts.map((draft, i) => (
              <DraftLineRow
                key={draft.draftId}
                draft={draft}
                rowIndex={displayRecords.length + i}
                autoFocus={draft.draftId === lastAddedDraftId}
                categoryOptions={categoryOptions}
                currencyCode={currencyCode}
                documentType={documentType}
                catalogItems={catalogItems}
                catalogGroups={catalogGroups}
                catalogItemMap={catalogItemMap}
                catalogLoading={catalogLoading}
                deleteDraft={deleteDraft}
                createDraft={createDraft}
                onSelectGroup={handleGroupPickDraft}
              />
            ))}
        </div>
      </div>

      <TotalsFooter
        documentType={documentType}
        readOnly={readOnly}
        currencyCode={currencyCode}
        lineRecordIds={lineRecordIds}
        draftLines={visibleDrafts}
        billingValues={billingValues}
        taxRates={taxRates}
        onUpdateDiscount={updateDiscount}
        onUpdateTax={updateTax}
      />
    </div>
  )
}
