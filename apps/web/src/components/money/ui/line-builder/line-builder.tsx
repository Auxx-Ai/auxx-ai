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
//   drafts; they still follow the same no-save-until-edited rule. An editable
//   builder also never renders zero rows: when the last real row and draft
//   are gone, one placeholder draft re-seeds automatically.
//   Every draft-state write goes through `mutateDrafts`, which updates
//   `draftsRef` synchronously and mirrors it into state — a plain `setDrafts`
//   built from a stale ref once clobbered a queued functional update and
//   persisted a blank line (plans/dispatch/31 §1.1), so the ref is the single
//   source of truth and `setDrafts` is never called directly.
// - Group explode: a catalog-group pick fills the picked line (entry #1),
//   stages entries 2…N as pre-filled phantom drafts in the same frame (also
//   dropping any untouched initial placeholders so the bundle lands directly
//   under the picked row), then materializes the whole bundle through ONE
//   `record.createMany` round-trip (`createDrafts`) — the bundle is fully
//   visible (and totaled) before any create resolves. The bundle stays
//   together in place: on a middle REAL row the staged drafts carry an
//   `anchorRecordId` (rendered interleaved under that row via `visualRows`)
//   and the createMany completion reorders the persisted rows to match; on
//   the draft-row path the drafts splice in right after the picked draft, and
//   the bundle create waits for entry #1's own create so real rows always
//   land in visual order.
// - Reorder: dnd-kit sortable rows (grip handle) → `api.money.reorderLines`.
//   Draft rows aren't part of the sortable set — they pin after the real rows.
// - Delete: optimistic — `removeRecord` drops the row from the record store
//   (and every cached list, so `TotalsFooter` repaints in the same frame),
//   then `api.record.delete` + `api.money.recomputeTotals` (delete path
//   doesn't fire field-change hooks, §F.2) fire without awaiting; an error
//   restores the row via `invalidateRecord` + `refresh()`. Draft rows →
//   local splice, no network.

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
  parseRecordId,
  type RecordId,
  type RecordMeta,
  toRecordId,
  useRecordList,
  useRecordStore,
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
  type DocumentType,
  diffLineValues,
  type LinePatch,
  type LineValues,
  lineAttributesFor,
  linePatchToFieldValues,
  lineSchemaFor,
} from './line-values'
import { TotalsFooter } from './totals-footer'
import { useLineHotkeys } from './use-line-hotkeys'
import { useLineNav } from './use-line-nav'

// ─────────────────────────────────────────────────────────────────────────────
// Props / shared types
// ─────────────────────────────────────────────────────────────────────────────

export interface LineBuilderProps {
  documentRecordId: string
  documentType: DocumentType
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

const PAGE_SIZE = 100
const INITIAL_DRAFT_COUNT = 3
/** Stable sort ref — `useRecordList` keys its cache off this object. */
const LINE_SORT = [{ id: 'sortOrder', desc: false }]
/** Every fixed line-builder field is visible to the shared syncer. */
const LINE_FIELD_VISIBILITY = {}

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
  // Everything document-shaped is one lookup. See the warning on `LINE_SCHEMAS`.
  const schema = lineSchemaFor(documentType)
  const { resource } = useResource(schema.slug)
  const entityDefinitionId = resource?.id
  // Category options come from the field definition (not a hardcoded list) so
  // org-added categories appear in the badge dropdown with their own colors.
  const { fields: lineItemFields } = useResourceFields(schema.slug)
  const categoryOptions = useMemo<CategoryOption[]>(() => {
    const field = lineItemFields.find((f) => f.key === 'category')
    return (field?.options?.options ?? []).map((o) => ({
      value: o.value,
      label: o.label,
      color: o.color,
    }))
  }, [lineItemFields])
  // Field def for the photo popover (line-photo-popover.tsx, plans 37b §4 / 40) —
  // `null` on a pre-migration org that hasn't picked up the `line_item.photos`
  // registry field yet, in which case `LineRow` renders no photo affordance at all.
  const photosField = useMemo(
    () => lineItemFields.find((f) => f.key === 'photos') ?? null,
    [lineItemFields]
  )
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
  // Everything else reads off the schema; see the warning on `LINE_SCHEMAS`.
  const { billingPrefix } = schema
  // `computed` is the only mode that WRITES a discount/tax mirror. `stored`
  // (vendor bill) still fetches its billing attrs so the footer can display the
  // transcribed totals, but nothing here may set them.
  const hasBilling = schema.totalsMode === 'computed'
  const { values: billingValues } = useSystemValues(docRecordId, schema.billingAttrs, {
    autoFetch: schema.billingAttrs.length > 0,
    enabled: schema.billingAttrs.length > 0,
  })
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
  /**
   * Single draft-state writer: applies the update to `draftsRef` synchronously
   * and mirrors the result into state, so two writers in one tick can never
   * clobber each other's queued update (the plan-31 §1.1 blank-line bug).
   * `fn` runs exactly once, synchronously — side effects inside are safe.
   */
  const mutateDrafts = useCallback((fn: (prev: DraftLine[]) => DraftLine[]) => {
    draftsRef.current = fn(draftsRef.current)
    setDrafts(draftsRef.current)
  }, [])
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
    const conditions: ConditionGroup['conditions'] = [
      {
        id: 'line-builder-document',
        // The order and purchasing arms are the plainest: no work-order exclusion
        // (that invariant is about an invoice's own lines) and no visit split.
        fieldId: schema.relFieldId,
        operator: 'is',
        value: documentRecordId,
      },
    ]
    if (schema.capabilities.excludeWorkOrderSourceLines) {
      conditions.push({
        id: 'line-builder-invoice-workorder',
        fieldId: 'line_item:workOrder',
        operator: 'empty',
        value: null,
      })
    }
    if (schema.capabilities.visitScoped) {
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
  }, [schema, documentRecordId, visitId])

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
    mutateDrafts(() => initialDrafts)
    setLastAddedDraftId(initialDrafts[0]?.draftId ?? null)
  }, [entityDefinitionId, readOnly, displayRecords.length, mutateDrafts])

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
    mutateDrafts((current) => current.filter((draft) => !initialDraftIds.has(draft.draftId)))
    setLastAddedDraftId((current) => (current && initialDraftIds.has(current) ? null : current))
  }, [displayRecords.length, mutateDrafts])

  // An editable builder never renders zero rows: when the last real row AND
  // the last draft are gone (final line deleted, last placeholder trashed),
  // re-seed one placeholder draft. It shares the initial-placeholder
  // lifecycle — hidden again if a persisted row (re)appears (e.g. a failed
  // delete restoring via refresh()), no record until its first edit. The
  // initial-seed effect above owns the first paint (3 placeholders); this
  // only re-arms after it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-check on any row-set change; refs hold the truth
  useEffect(() => {
    if (!entityDefinitionId || readOnly || !seededInitialDraftsRef.current) return
    if (displayRecords.length > 0 || draftsRef.current.length > 0) return
    const draft = freshDraft(generateId())
    initialDraftIdsRef.current.add(draft.draftId)
    mutateDrafts(() => [draft])
    setLastAddedDraftId(draft.draftId)
  }, [entityDefinitionId, readOnly, displayRecords.length, drafts.length, mutateDrafts])

  // Visual row list — each real row followed by any bundle drafts anchored to
  // it (a catalog-group pick on a middle row), then unanchored drafts pinned
  // at the tail. Nav row indexes are sequential across the interleaved list,
  // so `useLineNav` and the focus-restore selector keep working unchanged.
  const visualRows = useMemo(() => {
    const anchored = new Map<string, DraftLine[]>()
    const tailDrafts: DraftLine[] = []
    const recordIds = new Set(displayRecords.map((r) => r.id))
    for (const draft of visibleDrafts) {
      // A dangling anchor (row deleted mid-flight) falls back to the tail.
      if (draft.anchorRecordId && recordIds.has(draft.anchorRecordId)) {
        const bucket = anchored.get(draft.anchorRecordId)
        if (bucket) bucket.push(draft)
        else anchored.set(draft.anchorRecordId, [draft])
      } else {
        tailDrafts.push(draft)
      }
    }
    const rows: Array<
      | { kind: 'record'; record: RecordMeta; rowIndex: number }
      | { kind: 'draft'; draft: DraftLine; rowIndex: number }
    > = []
    for (const record of displayRecords) {
      rows.push({ kind: 'record', record, rowIndex: rows.length })
      for (const draft of anchored.get(record.id) ?? []) {
        rows.push({ kind: 'draft', draft, rowIndex: rows.length })
      }
    }
    for (const draft of tailDrafts) rows.push({ kind: 'draft', draft, rowIndex: rows.length })
    return rows
  }, [displayRecords, visibleDrafts])

  const lineRecordIds = useMemo(
    () =>
      entityDefinitionId ? displayRecords.map((r) => toRecordId(entityDefinitionId, r.id)) : [],
    [entityDefinitionId, displayRecords]
  )

  // Match records-view's fetch ownership: queue the complete displayed
  // record-id × line-field matrix once, while rows subscribe passively.
  const systemAttributeMap = useResourceStore((state) => state.systemAttributeMap)
  const lineFieldIds = useMemo(() => {
    return lineAttributesFor(schema)
      .map((attribute) => systemAttributeMap[attribute])
      .filter((fieldId): fieldId is NonNullable<typeof fieldId> => !!fieldId)
  }, [schema, systemAttributeMap])
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
  const createManyRecords = api.record.createMany.useMutation()
  const { mutate: reorderMutate } = reorderLines
  const { mutate: recomputeMutate } = recomputeTotals
  const { mutateAsync: deleteMutateAsync } = deleteRecord
  const { mutateAsync: deleteInvoiceLineMutateAsync } = deleteInvoiceLine
  const { mutateAsync: createMutateAsync } = createRecord
  const { mutateAsync: createManyMutateAsync } = createManyRecords

  const { saveFieldValue, saveMultipleAsync } = useSaveFieldValue()
  const { seedCreatedRecord } = useSeedCreatedRecord()

  /** Persist one semantic line patch through the single optimistic save owner. */
  const updateLine = useCallback(
    (recordId: RecordId, patch: LinePatch) => {
      const updates = linePatchToFieldValues(patch, schema)
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

  /**
   * Write one of a `stated` document's own amount mirrors (`shipping_total`,
   * `tax_total`, `discount_value`).
   *
   * 🛑 These are INPUTS, not derived figures — `purchase_order_shipping_total` is
   * described in the registry as *"typed by hand from the freight invoice"* and is
   * what `allocateLandedCost` spreads across the lines on receipt. All three are
   * `creatable: true, updatable: true` and `showInPanel: false`, so this footer is
   * the ONLY place in the app they can be entered. Rendering them read-only (which
   * is what `stated` did at first) leaves landed cost permanently unreachable.
   */
  const updateStatedAmount = useCallback(
    (attribute: string, cents: number | null) => {
      if (schema.totalsMode !== 'stated') return
      saveFieldValue(docRecordId, `${billingPrefix}_${attribute}`, cents, FieldType.CURRENCY)
    },
    [schema.totalsMode, saveFieldValue, docRecordId, billingPrefix]
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
    (lineId: string) => {
      if (!entityDefinitionId) return
      // Optimistic: drop the record from the store (and every cached list —
      // `lineRecordIds` shrinks, so the row AND the totals footer repaint in
      // this frame), then fire the delete without awaiting. No `refresh()` on
      // success — the store is already correct, and the refetch is what made
      // deletes feel slow.
      useRecordStore.getState().removeRecord(entityDefinitionId, lineId)
      const restoreOnError = (error: unknown) => {
        // `removeRecord` marked the id not-found, which `requestRecord` would
        // skip — clear that marker first so the refetched list can resurrect
        // the row.
        useRecordStore.getState().invalidateRecord(entityDefinitionId, lineId)
        refresh()
        toastError({
          title: 'Error deleting line',
          description: error instanceof Error ? error.message : 'Could not delete the line',
        })
      }
      if (schema.capabilities.deleteMode === 'unstamp') {
        // Unstamps the gathered source line + recomputes totals server-side
        // (money MI1 build spec §G.3) — NOT the quote's record.delete + recompute pair.
        deleteInvoiceLineMutateAsync({
          lineRecordId: toRecordId(entityDefinitionId, lineId),
        }).catch(restoreOnError)
      } else {
        deleteMutateAsync({ recordId: toRecordId(entityDefinitionId, lineId) })
          .then(() => {
            // Deletes don't fire field-change hooks — recompute explicitly (§F.2).
            // Every totalled document needs this; work_order stores no totals.
            // `recordId` (not the legacy `quoteRecordId`) so the router derives
            // the document type from the def component.
            if (schema.totalsMode === 'computed') {
              recomputeMutate({ recordId: docRecordId })
            }
          })
          .catch(restoreOnError)
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
  const deleteDraft = useCallback(
    (draftId: string) => {
      creatingDraftIdsRef.current.delete(draftId)
      initialDraftIdsRef.current.delete(draftId)
      mutateDrafts((prev) => prev.filter((d) => d.draftId !== draftId))
    },
    [mutateDrafts]
  )

  /**
   * "+ Add line item" (and keyboard nav past the last row) — pushes a
   * purely-local phantom draft and marks it as the one to auto-focus. No mutation.
   */
  const addLine = useCallback(() => {
    const draft = freshDraft(generateId())
    setLastAddedDraftId(draft.draftId)
    mutateDrafts((prev) => [...prev, draft])
  }, [mutateDrafts])

  /** Build a draft's `record.create` values payload (shared by the single and bulk paths). */
  const draftCreateValues = useCallback(
    (snapshot: DraftLine, sortOrder: number): Record<string, unknown> => {
      const values: Record<string, unknown> = {
        [schema.relKey]: documentRecordId,
        [schema.sortAttr]: sortOrder,
      }
      // Keys the schema maps to `null` are dropped rather than sent — a
      // purchasing line has no `taxable`/`optional` field, and a create carrying
      // one names a field id that does not resolve on that entity.
      const set = (key: keyof LineValues, value: unknown) => {
        const attr = schema.attrs[key]
        if (attr) values[attr] = value
      }
      set('qty', snapshot.qty)
      set('unit', snapshot.unit)
      set('taxable', snapshot.taxable)
      set('optional', snapshot.optional)
      set('optionalSelected', snapshot.optionalSelected)
      if (visitId && schema.capabilities.visitScoped) values.line_item_visit_id = visitId
      if (snapshot.name) set('name', snapshot.name)
      if (snapshot.description) set('description', snapshot.description)
      if (snapshot.category) set('category', snapshot.category)
      if (snapshot.unitPriceCents !== null) set('unitPriceCents', snapshot.unitPriceCents)
      if (snapshot.catalogItemRecordId) set('catalogItemRecordId', snapshot.catalogItemRecordId)
      if (snapshot.partRecordId) set('partRecordId', snapshot.partRecordId)
      return values
    },
    [schema, documentRecordId, visitId]
  )

  /**
   * Fire the draft's first `record.create`, carrying every accumulated draft
   * value (merged with `overrides`, the field that just committed). Guarded
   * against double-create: once a draft is already creating, subsequent
   * commits just keep mutating local state — the in-flight create's
   * completion handler diffs + flushes them once it resolves.
   */
  const createDraft = useCallback(
    async (draftId: string, overrides: LinePatch = {}) => {
      // The first real edit retires the whole initial-placeholder concept: the
      // edited draft materializes into a real record, and the remaining seeded
      // rows demote to ordinary empty drafts instead of being cleared as stale
      // placeholders. Clearing the WHOLE set (not just this id) is what keeps
      // the other default rows on screen after you fill one in — placeholder
      // replacement only ever runs before the user has touched anything.
      initialDraftIdsRef.current.clear()
      const accumulate = () =>
        mutateDrafts((prev) =>
          prev.map((d) => (d.draftId === draftId ? { ...d, ...overrides } : d))
        )
      if (creatingDraftIdsRef.current.has(draftId)) {
        accumulate()
        return
      }
      // 🛑 A buy-side line's identity IS its part: `purchase_order_line.part` is
      // `required: true` and leg 2 of the natural key `(purchaseOrder, part)`. So
      // a qty, a price or a description typed before a part is picked must
      // ACCUMULATE on the draft rather than fire a create the server has to
      // reject. Guarding here rather than in each cell is what keeps every cell —
      // including any added later — safe by default.
      if (schema.capabilities.partPicker) {
        const pending = draftsRef.current.find((d) => d.draftId === draftId)
        const partRecordId = overrides.partRecordId ?? pending?.partRecordId ?? null
        if (!partRecordId) {
          accumulate()
          return
        }
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
      mutateDrafts((prev) => prev.map((d) => (d.draftId === draftId ? snapshot : d)))

      const values = draftCreateValues(snapshot, displayIdsRef.current.length + draftIndex)

      try {
        const result = await createMutateAsync({
          entityDefinitionId: schema.lineEntityType,
          values,
        })

        seedCreatedRecord({
          entityDefinitionId,
          recordId: result.recordId,
          listKey,
          instance: result.instance,
          values: linePatchToFieldValues(snapshot, schema),
        })

        // Diff whatever landed locally while the create was in flight, and
        // flush just the changed fields against the now-real record.
        const latest = draftsRef.current.find((d) => d.draftId === draftId) ?? snapshot
        const changed = linePatchToFieldValues(diffLineValues(snapshot, latest), schema)
        if (changed.length > 0) {
          await saveMultipleAsync(result.recordId, changed)
        }

        creatingDraftIdsRef.current.delete(draftId)
        mutateDrafts((prev) => prev.filter((d) => d.draftId !== draftId))
      } catch (error) {
        creatingDraftIdsRef.current.delete(draftId)
        mutateDrafts((prev) =>
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
      draftCreateValues,
      mutateDrafts,
      createMutateAsync,
      saveMultipleAsync,
      seedCreatedRecord,
      listKey,
    ]
  )

  /**
   * Materialize a staged bundle of pre-filled drafts through ONE
   * `record.createMany` round-trip (plan 31 §D). Marks every draft
   * `creating`, calls `createMany` (all-or-nothing server-side), then per
   * result — in input order, so the list cache appends agree with the
   * `line_item_sort_order` stamps — seeds the record + field-value caches and
   * diff-flushes anything the user edited while the create was in flight.
   * Anchored bundles (a middle-row group pick) finish with one `reorderLines`
   * that splices the created rows in directly after their anchor row.
   * On error, every bundle draft resets to editable with one toast.
   */
  const createDrafts = useCallback(
    async (bundleDrafts: DraftLine[]) => {
      if (!entityDefinitionId || bundleDrafts.length === 0) return
      const draftIds = new Set(bundleDrafts.map((d) => d.draftId))
      for (const draftId of draftIds) {
        initialDraftIdsRef.current.delete(draftId)
        creatingDraftIdsRef.current.add(draftId)
      }

      // Snapshot each draft's CURRENT values (edits may have landed since
      // staging) while marking them all `creating` in one write.
      const snapshots = new Map<string, DraftLine>()
      mutateDrafts((prev) =>
        prev.map((d) => {
          if (!draftIds.has(d.draftId)) return d
          const snapshot: DraftLine = { ...d, creating: true }
          snapshots.set(d.draftId, snapshot)
          return snapshot
        })
      )

      const orderedDrafts = bundleDrafts.filter((d) => snapshots.has(d.draftId))
      const records = orderedDrafts.map((draft) => {
        const draftIndex = draftsRef.current.findIndex((d) => d.draftId === draft.draftId)
        return draftCreateValues(
          snapshots.get(draft.draftId)!,
          displayIdsRef.current.length + draftIndex
        )
      })
      if (records.length === 0) return

      try {
        const results = await createManyMutateAsync({
          entityDefinitionId: schema.lineEntityType,
          records,
        })

        const flushes: Promise<unknown>[] = []
        results.forEach((result, i) => {
          const draft = orderedDrafts[i]
          const snapshot = draft ? snapshots.get(draft.draftId) : undefined
          if (!draft || !snapshot) return
          seedCreatedRecord({
            entityDefinitionId,
            recordId: result.recordId,
            listKey,
            instance: result.instance,
            values: linePatchToFieldValues(snapshot, schema),
          })
          const latest = draftsRef.current.find((d) => d.draftId === draft.draftId) ?? snapshot
          const changed = linePatchToFieldValues(diffLineValues(snapshot, latest), schema)
          if (changed.length > 0) flushes.push(saveMultipleAsync(result.recordId, changed))
        })

        for (const draftId of draftIds) creatingDraftIdsRef.current.delete(draftId)
        mutateDrafts((prev) => prev.filter((d) => !draftIds.has(d.draftId)))

        // Anchored bundle (group pick on a middle row): the creates append at
        // the list end, so splice the new rows in directly after their anchor
        // and persist that order — otherwise the bundle tears apart on the
        // next refetch. Anchor gone (deleted mid-flight) or already the last
        // row → the natural append order is already correct.
        const anchorRecordId = orderedDrafts[0]?.anchorRecordId
        if (anchorRecordId) {
          const createdIds = results.map((result) => result.instance.id)
          const createdIdSet = new Set(createdIds)
          const existing = displayIdsRef.current.filter((id) => !createdIdSet.has(id))
          const anchorIndex = existing.indexOf(anchorRecordId)
          if (anchorIndex !== -1 && anchorIndex < existing.length - 1) {
            const nextOrder = [
              ...existing.slice(0, anchorIndex + 1),
              ...createdIds,
              ...existing.slice(anchorIndex + 1),
            ]
            setOrderOverride(nextOrder)
            reorderMutate({
              documentRecordId: docRecordId,
              lineEntityType: schema.lineEntityType,
              orderedLineRecordIds: nextOrder.map((id) => toRecordId(entityDefinitionId, id)),
            })
          }
        }

        await Promise.all(flushes)
      } catch (error) {
        for (const draftId of draftIds) creatingDraftIdsRef.current.delete(draftId)
        mutateDrafts((prev) =>
          prev.map((d) => (draftIds.has(d.draftId) ? { ...d, creating: false } : d))
        )
        toastError({
          title: 'Error adding lines',
          description: error instanceof Error ? error.message : 'Could not add the lines',
        })
      }
    },
    [
      entityDefinitionId,
      docRecordId,
      draftCreateValues,
      mutateDrafts,
      createManyMutateAsync,
      saveMultipleAsync,
      seedCreatedRecord,
      reorderMutate,
      listKey,
    ]
  )

  /**
   * Step 2 of a catalog-group explode (money 09-product-groups.md
   * "Line-builder consumption"): stage entries 2…N as pre-filled phantom
   * drafts IMMEDIATELY — instant paint, and totals are right on the first
   * frame (`TotalsFooter` already folds drafts into its math). The same write
   * drops any untouched initial placeholder drafts (plan 31 §C) so the bundle
   * lands directly under the picked row instead of below empty warm-up rows.
   * `position` keeps the bundle together on a middle-row pick: `anchorRecordId`
   * pins the drafts under that real row (see `visualRows`), `afterDraftId`
   * splices them into the drafts array right after the picked draft.
   * Returns the staged drafts for {@link createDrafts} to materialize
   * (freshDraft's optional=false / optionalSelected=true defaults are exactly
   * the "group-exploded lines start required" rule, money plan 18 §3).
   */
  const stageBundleDrafts = useCallback(
    (
      rest: LineValues[],
      position?: { anchorRecordId?: string; afterDraftId?: string }
    ): DraftLine[] => {
      if (rest.length === 0) return []
      const bundleDrafts: DraftLine[] = rest.map((line) => ({
        ...freshDraft(generateId()),
        ...line,
        anchorRecordId: position?.anchorRecordId,
      }))
      const initialDraftIds = initialDraftIdsRef.current
      initialDraftIdsRef.current = new Set()
      mutateDrafts((prev) => {
        const kept = prev.filter((d) => !initialDraftIds.has(d.draftId))
        const at = position?.afterDraftId
          ? kept.findIndex((d) => d.draftId === position.afterDraftId)
          : -1
        return at === -1
          ? [...kept, ...bundleDrafts]
          : [...kept.slice(0, at + 1), ...bundleDrafts, ...kept.slice(at + 1)]
      })
      setLastAddedDraftId((current) => (current && initialDraftIds.has(current) ? null : current))
      return bundleDrafts
    },
    [mutateDrafts]
  )

  /**
   * Steps 4–5 of a catalog-group explode: document discount/tax set-if-unset —
   * quote/invoice only, never overwriting a value the document already has.
   */
  const applyGroupBilling = useCallback(
    (pick: ResolvedCatalogGroup) => {
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
    [hasBilling, billingPrefix, billingValues, taxRates, updateDiscount, updateTax]
  )

  /**
   * Explode a picked catalog group onto a REAL line (money 09-product-groups.md
   * "Line-builder consumption"): entry #1 fills the line whose picker was open,
   * entries 2…N are staged in the same frame and materialized through one
   * `record.createMany`.
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

      // Anchor the staged drafts to the picked row so the bundle renders (and
      // persists — createDrafts reorders after the createMany) directly under
      // it instead of appending at the list end.
      const bundleDrafts = stageBundleDrafts(rest, {
        anchorRecordId: parseRecordId(recordId).entityInstanceId,
      })
      applyGroupBilling(pick)
      void createDrafts(bundleDrafts)
    },
    [catalogItemMap, updateLine, stageBundleDrafts, applyGroupBilling, createDrafts]
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
      // lines start required (money plan 18 §3). Called BEFORE staging so its
      // synchronous prefix promotes the picked draft out of the initial
      // placeholder set — otherwise the §C cleanup below would drop it.
      const firstCreate = createDraft(draftId, first)

      // Splice the bundle right after the picked draft (not the drafts tail)
      // so it stays together even with user-added drafts below.
      const bundleDrafts = stageBundleDrafts(rest, { afterDraftId: draftId })
      applyGroupBilling(pick)

      // Materialize the bundle only after entry #1's create settles: real rows
      // append to the list cache in completion order, so entry #1 must land
      // first for the persisted rows to match the on-screen (and sort_order)
      // order. The bundle rows are already painted as drafts, so this costs
      // nothing visually. `createDraft` never rejects (it toasts internally).
      void firstCreate.then(() => createDrafts(bundleDrafts))
    },
    [catalogItemMap, createDraft, stageBundleDrafts, applyGroupBilling, createDrafts]
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
          lineEntityType: schema.lineEntityType,
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
    isQuote: schema.capabilities.optional,
    readOnly,
  })

  // Restore focus after a draft→real swap: when materialization detaches the
  // focused input, the browser parks focus on `<body>`. Only then (never when the
  // user intentionally clicked elsewhere) do we re-focus the same cell index.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on any row-set change (records/drafts)
  useLayoutEffect(() => {
    const target = focusedCellRef.current
    if (!target || document.activeElement !== document.body) return
    const totalRows = displayRecords.length + visibleDrafts.length
    if (totalRows === 0) return
    // Deleting the bottom row leaves the remembered index past the end — clamp
    // it so focus lands on the row above instead of dropping out of the grid.
    const row = Math.min(target.row, totalRows - 1)
    const sel = `[data-line-row="${row}"][data-line-col="${target.col}"]`
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
            {schema.primaryColumnLabel}
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
                {/* Interleaved real rows + phantom drafts (`visualRows`): anchored
                    bundle drafts render directly under their picked row, tail
                    drafts after every real row. Drafts are never drag-sortable —
                    only real record ids are in the SortableContext. */}
                {visualRows.map((row) =>
                  row.kind === 'record' ? (
                    <LineRow
                      key={row.record.id}
                      record={row.record}
                      rowIndex={row.rowIndex}
                      entityDefinitionId={entityDefinitionId}
                      categoryOptions={categoryOptions}
                      photosField={photosField}
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
                  ) : (
                    <DraftLineRow
                      key={row.draft.draftId}
                      draft={row.draft}
                      rowIndex={row.rowIndex}
                      autoFocus={row.draft.draftId === lastAddedDraftId}
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
                  )
                )}
              </SortableContext>
            </DndContext>
          )}
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
        onUpdateStatedAmount={updateStatedAmount}
      />
    </div>
  )
}
