// apps/web/src/components/money/ui/line-builder/line-builder.tsx

'use client'

// The document-agnostic line-items builder. Rows render as plain grid rows under one
// shared `grid-template-columns`; row and cell markup lives in `line-rows.tsx`, this
// file owns state and writes. Keyboard nav and focus restore come from `LineGridFrame`.
//
// Data flow (plans/entity/domain-tables/01-lines-module.md §3):
// - Rows are the `api.lines.list` cache for the document; `useLinesSync` applies other
//   tabs' `lines:updated` frames to it. Every write goes through `useLineWrites`, which
//   patches that cache optimistically and rolls back with a toast.
// - Add pushes a local phantom draft; the line is created on the draft's first real
//   commit, carrying everything accumulated on it. Edits made while the create is in
//   flight go out as one `updateMany` once it resolves. An untouched draft vanishes.
//   Every draft-state write goes through `mutateDrafts` (plans/dispatch/31 §1.1).
// - A catalog-group pick fills the picked line, stages the rest of the group as drafts
//   in the same frame, and creates them in one request, spliced after the picked row.
// - The footer shows the header's stored totals; the server recomputes them.

import { FieldType } from '@auxx/database/enums'
import {
  type Line,
  type LineDocumentType,
  lineKindFor,
} from '@auxx/lib/accounting/documents/lines/client'
import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import { parseRecordId } from '@auxx/lib/resources/client'
import { Button } from '@auxx/ui/components/button'
import { EmptySection } from '@auxx/ui/components/section'
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LineGridFrame } from '~/components/line-grid/ui/line-grid-frame'
import type { CatalogGroup } from '~/components/money/hooks/use-catalog-groups'
import { useCatalogGroups } from '~/components/money/hooks/use-catalog-groups'
import { useCatalogParts } from '~/components/money/hooks/use-catalog-parts'
import { type RecordId, useResource, useResourceFields } from '~/components/resources'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
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
  type LandedBillEditorRenderer,
  LINE_COLS,
  LineRow,
  type MatchKeyEditorRenderer,
  type PartPrefillLookup,
  type PartPrefillResolver,
} from './line-rows'
import {
  type LinePatch,
  type LineRelationDefs,
  type LineValues,
  lineValuesFromLine,
  toLinePatch,
} from './line-values'
import { useLinesSync, useLineWrites } from './lines-cache'
import { TotalsFooter } from './totals-footer'
import { useDraftCommits } from './use-draft-commits'
import { useLineHotkeys } from './use-line-hotkeys'

export interface LineBuilderProps {
  documentRecordId: string
  documentType: LineDocumentType
  readOnly?: boolean
  /**
   * Whether the footer's transcribed header amounts are inputs or text, on a `stored`
   * document. Defaults to {@link readOnly}; the vendor bill passes its own lock (73 D5).
   */
  amountsReadOnly?: boolean
  /**
   * work_order only: set → this visit's occurrence extras; unset → the job's per-cycle set.
   * The two never overlap (the server's list membership rule).
   */
  visitId?: string
  /** Extra classes merged onto the builder's scroll-container root. */
  className?: string
  /** Editor for a line's match key; a render prop so `money` never imports `purchasing`. */
  renderMatchKeyEditor?: MatchKeyEditorRenderer
  /** The landed-bill picker for a vendor bill line (73 §7.2). */
  renderLandedBillEditor?: LandedBillEditorRenderer
  /**
   * Supplier price lookup for a picked part (plans/purchasing/05 §5.2). Only called on a
   * document whose kind names a `vendorAttr` and whose parent carries a vendor.
   */
  resolvePartPrefill?: PartPrefillLookup
}

const INITIAL_DRAFT_COUNT = 3
const EMPTY_LINES: Line[] = []

/** Org tax rate preset (`documents.taxRates` setting, money MQ1 build spec §G.1). */
interface TaxRatePreset {
  id: string
  name: string
  rate: number
  isDefault?: boolean
}

/**
 * One document-agnostic line builder: quote, order, invoice, work order, credit memo and
 * the purchasing documents. Consumers pass only the document handle.
 */
export function LineBuilder({
  documentRecordId,
  documentType,
  readOnly = false,
  amountsReadOnly,
  visitId,
  className,
  renderMatchKeyEditor,
  renderLandedBillEditor,
  resolvePartPrefill,
}: LineBuilderProps) {
  const docRecordId = documentRecordId as RecordId
  const documentId = parseRecordId(docRecordId).entityInstanceId
  const kind = lineKindFor(documentType)
  const { resource } = useResource(kind.lineEntityType)
  const entityDefinitionId = resource?.id
  // Category options come from the field definition so org-added categories show too.
  const { fields: lineFields } = useResourceFields(kind.lineEntityType)
  const categoryOptions = useMemo<CategoryOption[]>(() => {
    const field = lineFields.find((f) => f.key === 'category')
    return (field?.options?.options ?? []).map((o) => ({
      value: o.value,
      label: o.label,
      color: o.color,
    }))
  }, [lineFields])
  // `null` on an org without the `line_item.photos` field: rows render no photo affordance.
  const photosField = useMemo(
    () => (kind.photosAttr ? (lineFields.find((f) => f.key === 'photos') ?? null) : null),
    [lineFields, kind.photosAttr]
  )

  // Relationship values are instance ids on a `Line`; the pickers take RecordIds.
  const partDefId = useResourceStore((s) => s.resourceMap.get('part')?.id)
  const poLineDefId = useResourceStore((s) => s.resourceMap.get('purchase_order_line')?.id)
  const vendorBillDefId = useResourceStore((s) => s.resourceMap.get('vendor_bill')?.id)
  const vendorPartDefId = useResourceStore((s) => s.resourceMap.get('vendor_part')?.id)
  const relationDefs = useMemo<LineRelationDefs>(
    () => ({
      part: partDefId,
      purchase_order_line: poLineDefId,
      vendor_bill: vendorBillDefId,
      vendor_part: vendorPartDefId,
    }),
    [partDefId, poLineDefId, vendorBillDefId, vendorPartDefId]
  )

  // Catalog data is shared by every row picker, preloaded once per editable builder.
  const catalogEnabled = !!entityDefinitionId && !readOnly && kind.capabilities.catalogPicker
  const {
    parts: catalogParts,
    partMap: catalogPartMap,
    isLoading: catalogPartsLoading,
  } = useCatalogParts({ enabled: catalogEnabled })
  const { groups: catalogGroups, isLoading: catalogGroupsLoading } = useCatalogGroups({
    enabled: catalogEnabled,
  })
  const catalogLoading = catalogPartsLoading || catalogGroupsLoading
  const { getSetting } = useSettings({})
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'

  const { billingPrefix } = kind
  // `computed` is the only mode that writes a discount/tax pair.
  const hasBilling = kind.totalsMode === 'computed'
  const { values: billingValues } = useSystemValues(docRecordId, kind.billingAttrs, {
    autoFetch: kind.billingAttrs.length > 0,
    enabled: kind.billingAttrs.length > 0,
  })
  // Read once per builder: scopes every row's match-key picker to the bill's own order.
  const { values: matchScopeValues } = useSystemValues(
    docRecordId,
    kind.matchScopeAttr ? [kind.matchScopeAttr] : [],
    { autoFetch: !!kind.matchScopeAttr, enabled: !!kind.matchScopeAttr }
  )
  const matchScopeRecordId = kind.matchScopeAttr
    ? (extractRelationshipRecordIds(matchScopeValues[kind.matchScopeAttr])[0] ?? null)
    : null
  // The supplier the price prefill resolves on; `null` on an order with no vendor yet.
  const { values: vendorValues } = useSystemValues(
    docRecordId,
    kind.vendorAttr ? [kind.vendorAttr] : [],
    { autoFetch: !!kind.vendorAttr, enabled: !!kind.vendorAttr }
  )
  const vendorRecordId = kind.vendorAttr
    ? (extractRelationshipRecordIds(vendorValues[kind.vendorAttr])[0] ?? null)
    : null

  const taxRates = useMemo(
    () =>
      ((getSetting('documents.taxRates') as TaxRatePreset[] | null) ?? []).filter(
        (rate) => rate && typeof rate.rate === 'number'
      ),
    [getSetting]
  )

  const listInput = useMemo(
    () => ({
      documentType,
      documentId,
      ...(kind.capabilities.visitScoped && visitId ? { visitId } : {}),
    }),
    [documentType, documentId, kind.capabilities.visitScoped, visitId]
  )
  const linesQuery = api.lines.list.useQuery(listInput, { enabled: !!documentId })
  const lines = linesQuery.data ?? EMPTY_LINES
  const isLoading = linesQuery.isLoading
  useLinesSync(documentType, documentId)
  const writes = useLineWrites({ documentType, documentId })

  const [orderOverride, setOrderOverride] = useState<string[] | null>(null)
  const [drafts, setDrafts] = useState<DraftLine[]>([])
  // The most recently added draft; its name cell auto-focuses on mount.
  const [lastAddedDraftId, setLastAddedDraftId] = useState<string | null>(null)
  const draftsRef = useRef<DraftLine[]>([])
  /** Single draft-state writer: updates the ref synchronously, then mirrors it into state. */
  const mutateDrafts = useCallback((fn: (prev: DraftLine[]) => DraftLine[]) => {
    draftsRef.current = fn(draftsRef.current)
    setDrafts(draftsRef.current)
  }, [])
  // The initial placeholders only: persisted rows replace these, never drafts added later.
  const seededInitialDraftsRef = useRef(false)
  const initialDraftIdsRef = useRef<Set<string>>(new Set())
  const rowsContainerRef = useRef<HTMLDivElement>(null)

  // Display order while a reorder settles; ids missing from the override append in server order.
  const displayLines = useMemo(() => {
    if (!orderOverride) return lines
    const byId = new Map(lines.map((line) => [line.id, line]))
    const overrideSet = new Set(orderOverride)
    const ordered = orderOverride
      .map((id) => byId.get(id))
      .filter((line): line is Line => line !== undefined)
    return [...ordered, ...lines.filter((line) => !overrideSet.has(line.id))]
  }, [lines, orderOverride])

  const displayIdsRef = useRef<string[]>([])
  displayIdsRef.current = displayLines.map((line) => line.id)

  const rowValues = useMemo(
    () => new Map(lines.map((line) => [line.id, lineValuesFromLine(line, kind, relationDefs)])),
    [lines, kind, relationDefs]
  )

  useEffect(() => {
    if (
      !entityDefinitionId ||
      readOnly ||
      seededInitialDraftsRef.current ||
      displayLines.length > 0 ||
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
  }, [entityDefinitionId, readOnly, displayLines.length, mutateDrafts])

  // Persisted lines hide the initial placeholders in the same render.
  const visibleDrafts = useMemo(() => {
    if (readOnly) return []
    if (displayLines.length === 0) return drafts
    return drafts.filter((draft) => !initialDraftIdsRef.current.has(draft.draftId))
  }, [displayLines.length, drafts, readOnly])

  // A document can lock while open (an order that ships): its unsaved drafts go with it.
  useEffect(() => {
    if (!readOnly || draftsRef.current.length === 0) return
    initialDraftIdsRef.current = new Set()
    mutateDrafts(() => [])
    setLastAddedDraftId(null)
  }, [readOnly, mutateDrafts])

  useEffect(() => {
    if (displayLines.length === 0 || initialDraftIdsRef.current.size === 0) return
    const initialDraftIds = initialDraftIdsRef.current
    initialDraftIdsRef.current = new Set()
    mutateDrafts((current) => current.filter((draft) => !initialDraftIds.has(draft.draftId)))
    setLastAddedDraftId((current) => (current && initialDraftIds.has(current) ? null : current))
  }, [displayLines.length, mutateDrafts])

  // An editable builder never renders zero rows: re-seed one placeholder draft.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-check on any row-set change; refs hold the truth
  useEffect(() => {
    if (!entityDefinitionId || readOnly || !seededInitialDraftsRef.current) return
    if (displayLines.length > 0 || draftsRef.current.length > 0) return
    const draft = freshDraft(generateId())
    initialDraftIdsRef.current.add(draft.draftId)
    mutateDrafts(() => [draft])
    setLastAddedDraftId(draft.draftId)
  }, [entityDefinitionId, readOnly, displayLines.length, drafts.length, mutateDrafts])

  // Each real row followed by the bundle drafts anchored to it, then the tail drafts.
  const visualRows = useMemo(() => {
    const anchored = new Map<string, DraftLine[]>()
    const tailDrafts: DraftLine[] = []
    const lineIds = new Set(displayLines.map((line) => line.id))
    for (const draft of visibleDrafts) {
      // A dangling anchor (row deleted mid-flight) falls back to the tail.
      if (draft.anchorLineId && lineIds.has(draft.anchorLineId)) {
        const bucket = anchored.get(draft.anchorLineId)
        if (bucket) bucket.push(draft)
        else anchored.set(draft.anchorLineId, [draft])
      } else {
        tailDrafts.push(draft)
      }
    }
    const rows: Array<
      | { kind: 'line'; line: Line; rowIndex: number }
      | { kind: 'draft'; draft: DraftLine; rowIndex: number }
    > = []
    for (const line of displayLines) {
      rows.push({ kind: 'line', line, rowIndex: rows.length })
      for (const draft of anchored.get(line.id) ?? []) {
        rows.push({ kind: 'draft', draft, rowIndex: rows.length })
      }
    }
    for (const draft of tailDrafts) rows.push({ kind: 'draft', draft, rowIndex: rows.length })
    return rows
  }, [displayLines, visibleDrafts])

  /** The consumer's vendor-part lookup with this document's vendor bound in, or `undefined`. */
  const boundResolvePartPrefill = useMemo<PartPrefillResolver | undefined>(() => {
    if (!resolvePartPrefill || !vendorRecordId) return undefined
    return (partRecordId) => resolvePartPrefill({ partRecordId, vendorRecordId })
  }, [resolvePartPrefill, vendorRecordId])

  // Document-level on purpose: a partly weighed set breaks the freight allocation (§5.3).
  const hasWeight = kind.fields.includes('weight')
  const [weightDeclared, setWeightDeclared] = useState(false)
  const revealWeight = useCallback(() => setWeightDeclared(true), [])
  const weightRevealed =
    hasWeight &&
    (weightDeclared ||
      visibleDrafts.some((draft) => draft.weight !== null) ||
      lines.some((line) => line.weight !== null))

  const { saveFieldValue, saveMultipleAsync } = useSaveFieldValue()

  const updateLine = useCallback(
    (lineId: string, patch: LinePatch) => writes.update(lineId, toLinePatch(patch, kind)),
    [writes, kind]
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
   * Write one of the document's own amount inputs: shipping / tax / discount on a `stated`
   * document, the transcribed headers on a `stored` one. This footer is their only editor.
   */
  const updateStatedAmount = useCallback(
    (attribute: string, cents: number | null) => {
      if (kind.totalsMode === 'none' || kind.totalsMode === 'computed') return
      saveFieldValue(docRecordId, `${billingPrefix}_${attribute}`, cents, FieldType.CURRENCY)
    },
    [kind.totalsMode, saveFieldValue, docRecordId, billingPrefix]
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

  const deleteLine = useCallback((lineId: string) => writes.remove([lineId]), [writes])

  const { createDraft, createDrafts, applyPrefillPatch, deleteDraft } = useDraftCommits({
    kind,
    visitId,
    enabled: !!entityDefinitionId,
    writes,
    draftsRef,
    mutateDrafts,
    initialDraftIdsRef,
    displayIdsRef,
  })

  /** "+ Add line item" and nav past the last row: a local draft, auto-focused. */
  const addLine = useCallback(() => {
    const draft = freshDraft(generateId())
    setLastAddedDraftId(draft.draftId)
    mutateDrafts((prev) => [...prev, draft])
  }, [mutateDrafts])

  /**
   * Step 2 of a catalog-group explode: stage entries 2…N as pre-filled drafts in the same
   * frame, dropping untouched placeholders so the bundle lands under the picked row.
   */
  const stageBundleDrafts = useCallback(
    (rest: LineValues[], position?: { anchorLineId?: string; afterDraftId?: string }) => {
      if (rest.length === 0) return []
      const bundleDrafts: DraftLine[] = rest.map((line) => ({
        ...freshDraft(generateId()),
        ...line,
        anchorLineId: position?.anchorLineId,
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

  /** Group discount/tax, set-if-unset, on a `computed` document only. */
  const applyGroupBilling = useCallback(
    (pick: ResolvedCatalogGroup) => {
      if (!hasBilling) return
      const currentDiscountValue = billingValues[`${billingPrefix}_discount_value`] as
        | number
        | null
        | undefined
      if (pick.discountType && pick.discountValue !== null && currentDiscountValue == null) {
        updateDiscount(pick.discountType, pick.discountValue)
      }
      const currentTaxRate = billingValues[`${billingPrefix}_tax_rate`] as number | null | undefined
      if (pick.taxRateId && currentTaxRate == null) {
        // A deleted preset id silently no-ops.
        const preset = taxRates.find((r) => r.id === pick.taxRateId)
        if (preset) updateTax(preset.name, preset.rate)
      }
    },
    [hasBilling, billingPrefix, billingValues, taxRates, updateDiscount, updateTax]
  )

  /** Explode a picked catalog group onto a real line: entry #1 fills it, the rest follow it. */
  const handleGroupPick = useCallback(
    (lineId: string, group: CatalogGroup) => {
      const pick = resolveCatalogGroup(group, catalogPartMap)
      if (pick.skippedCount > 0) {
        console.warn(`Catalog group "${pick.name}" skipped ${pick.skippedCount} dangling item(s).`)
      }
      const [first, ...rest] = pick.lines
      if (!first) return
      updateLine(lineId, first)
      const bundleDrafts = stageBundleDrafts(rest, { anchorLineId: lineId })
      applyGroupBilling(pick)
      void createDrafts(bundleDrafts)
    },
    [catalogPartMap, updateLine, stageBundleDrafts, applyGroupBilling, createDrafts]
  )

  /** Same explode, targeting a draft: the bundle is created once entry #1's create settles. */
  const handleGroupPickDraft = useCallback(
    (draftId: string, group: CatalogGroup) => {
      const pick = resolveCatalogGroup(group, catalogPartMap)
      if (pick.skippedCount > 0) {
        console.warn(`Catalog group "${pick.name}" skipped ${pick.skippedCount} dangling item(s).`)
      }
      const [first, ...rest] = pick.lines
      if (!first) return
      // Before staging: its synchronous prefix promotes the draft out of the placeholder set.
      const firstCreate = createDraft(draftId, first)
      const bundleDrafts = stageBundleDrafts(rest, { afterDraftId: draftId })
      applyGroupBilling(pick)
      // Tail appends land in completion order, so entry #1 must land first.
      void firstCreate.then(() => createDrafts(bundleDrafts))
    },
    [catalogPartMap, createDraft, stageBundleDrafts, applyGroupBilling, createDrafts]
  )

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const current = displayIdsRef.current
      const oldIndex = current.indexOf(String(active.id))
      const newIndex = current.indexOf(String(over.id))
      if (oldIndex === -1 || newIndex === -1) return

      const nextOrder = arrayMove(current, oldIndex, newIndex)
      setOrderOverride(nextOrder)
      void writes.reorder(nextOrder).then(() => setOrderOverride(null))
    },
    [writes]
  )

  useLineHotkeys({ containerRef: rowsContainerRef, kind, readOnly })

  if (!entityDefinitionId) return null

  const rowCount = displayLines.length + visibleDrafts.length
  // 4 where the amount cell is an input, so nav never lands on a column with nothing to focus.
  const colCount = kind.amountMode === 'stored' || kind.amountMode === 'derived-editable' ? 4 : 3
  const isEmpty = !isLoading && displayLines.length === 0 && visibleDrafts.length === 0

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col  rounded-lg', className)}>
      <LineGridFrame
        containerRef={rowsContainerRef}
        cols={LINE_COLS}
        header={[
          {
            label: kind.primaryColumnLabel,
            addButton: !readOnly && (
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
            ),
          },
          { label: 'Qty', align: 'end' },
          { label: 'Rate', align: 'end' },
          { label: 'Total', align: 'end' },
        ]}
        rowCount={rowCount}
        colCount={colCount}
        onAddRow={addLine}
        readOnly={readOnly}
        showEmpty={isEmpty && readOnly}
        empty={
          <EmptySection
            className='border-transparent ring-0'
            icon={<ReceiptText className='size-5' />}
            title='No line items'
          />
        }>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          modifiers={[restrictToVerticalAxis]}>
          <SortableContext
            items={displayIdsRef.current}
            strategy={verticalListSortingStrategy}
            disabled={readOnly}>
            {/* Only real line ids are sortable; drafts pin under their anchor or the tail. */}
            {visualRows.map((row) => {
              if (row.kind === 'draft') {
                return (
                  <DraftLineRow
                    key={row.draft.draftId}
                    draft={row.draft}
                    rowIndex={row.rowIndex}
                    autoFocus={row.draft.draftId === lastAddedDraftId}
                    categoryOptions={categoryOptions}
                    currencyCode={currencyCode}
                    documentType={documentType}
                    catalogParts={catalogParts}
                    catalogGroups={catalogGroups}
                    catalogPartMap={catalogPartMap}
                    catalogLoading={catalogLoading}
                    matchScopeRecordId={matchScopeRecordId}
                    renderMatchKeyEditor={renderMatchKeyEditor}
                    renderLandedBillEditor={renderLandedBillEditor}
                    weightRevealed={weightRevealed}
                    resolvePartPrefill={boundResolvePartPrefill}
                    onRevealWeight={revealWeight}
                    deleteDraft={deleteDraft}
                    createDraft={createDraft}
                    applyPrefillPatch={applyPrefillPatch}
                    onSelectGroup={handleGroupPickDraft}
                  />
                )
              }
              const values = rowValues.get(row.line.id)
              if (!values) return null
              return (
                <LineRow
                  key={row.line.id}
                  line={row.line}
                  values={values}
                  rowIndex={row.rowIndex}
                  entityDefinitionId={entityDefinitionId}
                  categoryOptions={categoryOptions}
                  photosField={photosField}
                  readOnly={readOnly}
                  currencyCode={currencyCode}
                  documentType={documentType}
                  catalogParts={catalogParts}
                  catalogGroups={catalogGroups}
                  catalogPartMap={catalogPartMap}
                  catalogLoading={catalogLoading}
                  matchScopeRecordId={matchScopeRecordId}
                  renderMatchKeyEditor={renderMatchKeyEditor}
                  renderLandedBillEditor={renderLandedBillEditor}
                  weightRevealed={weightRevealed}
                  resolvePartPrefill={boundResolvePartPrefill}
                  onRevealWeight={revealWeight}
                  onUpdateLine={updateLine}
                  deleteLine={deleteLine}
                  onSelectGroup={handleGroupPick}
                />
              )
            })}
          </SortableContext>
        </DndContext>
      </LineGridFrame>

      <TotalsFooter
        documentType={documentType}
        readOnly={readOnly}
        amountsReadOnly={amountsReadOnly}
        currencyCode={currencyCode}
        lines={lines}
        billingValues={billingValues}
        taxRates={taxRates}
        onUpdateDiscount={updateDiscount}
        onUpdateTax={updateTax}
        onUpdateStatedAmount={updateStatedAmount}
      />
    </div>
  )
}
