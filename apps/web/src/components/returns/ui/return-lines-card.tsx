// apps/web/src/components/returns/ui/return-lines-card.tsx
'use client'

// `return:lines`: the return's own line-item grid, on the document-agnostic
// `~/components/line-grid` kit (plans/money/tasks/56-return-lines-on-the-line-grid.md
// §4). The card that gives the return drawer a way to CREATE a `return_line`
// at all; before this landed, the Salvage card's line picker
// (`return-salvage-container.tsx`) had nothing to list, forever.
//
// Declared ABOVE Salvage in `drawer-config.ts`'s `return` overview cards (the
// coordinator's registration): the tree hangs off a line, and this is where
// lines come from.
//
// Rows are `return_line` records filtered on `return_line:return = this
// return`, sorted `createdAt` ascending, preloaded once through
// `useFieldValueSyncer`, the same "one fetch for the whole displayed
// matrix, each row a passive subscription" shape `LineBuilder` uses
// (`documentLineFilters`, `LINE_PAGE_SIZE`, `useFieldValueSyncer` in
// money/ui/line-builder/line-builder.tsx). Inline edits write through
// `useSaveFieldValue` (§4.3), never `return.updateLine`, which stays the
// programmatic door.
//
// Adding a line: the header `+` (or Enter/ArrowDown/Tab past the last row,
// via the frame's `onAddRow`) pushes a local draft
// (`use-return-line-drafts.ts`); its part pick is the only thing that writes
// anything (§4.4). "Add from order" (`add-from-order-sheet.tsx`) is the bulk
// door, present only when the return names an order.

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { Button } from '@auxx/ui/components/button'
import { EmptySection } from '@auxx/ui/components/section'
import { Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { useLineRowActions } from '~/components/line-grid/hooks/use-line-row-actions'
import { LineGridFrame } from '~/components/line-grid/ui/line-grid-frame'
import { useRecordDrawerReadOnly } from '~/components/records/use-record-drawer-read-only'
import { useFieldValueSyncer } from '~/components/resources/hooks/use-field-value-syncer'
import { useRecordList } from '~/components/resources/hooks/use-record-list'
import { useRecords } from '~/components/resources/hooks/use-records'
import { useResource } from '~/components/resources/hooks/use-resource'
import {
  getRecordStoreState,
  parseRecordId,
  type RecordId,
  type RecordMeta,
  toRecordId,
} from '~/components/resources/store'
import { useResourceStore } from '~/components/resources/store/resource-store'
import { api } from '~/trpc/react'
import { useReturnLineDrafts } from '../hooks/use-return-line-drafts'
import { AddFromOrderSheet } from './add-from-order-sheet'
import {
  RETURN_LINE_COLS,
  ReturnLineDraftRow,
  ReturnLineRow,
  type ReturnLineRowAction,
} from './return-line-row'

/** Everything a row reads, queued once for the whole displayed set. */
const RETURN_LINE_SYNC_ATTRS = [
  'return_line_part',
  'return_line_line_item',
  'return_line_quantity',
  'return_line_condition_grade',
  'return_line_liability',
  'return_line_inspection_notes',
  'return_line_photos',
  'return_line_part_lines',
]

const RETURN_LINE_SORT = [{ id: 'createdAt', desc: false }]
const RETURN_LINE_PAGE_SIZE = 100
const NO_COLUMN_VISIBILITY = {}

/**
 * The return's own `return_line` rows, on the shared line-grid kit. See the
 * file doc for the write path and the draft rhythm.
 */
export function ReturnLinesCard({ recordId, entityInstanceId }: DrawerTabProps) {
  const readOnly = useRecordDrawerReadOnly(
    parseRecordId(recordId).entityDefinitionId,
    entityInstanceId
  )

  const { resource } = useResource('return_line')
  const entityDefinitionId = resource?.id

  const utils = api.useUtils()
  const { data: returnData } = api.return.get.useQuery({ returnRecordId: recordId })
  const orderId = returnData?.orderId ?? null
  const orderRecordId = useMemo<RecordId | null>(
    () => (orderId ? toRecordId('order', orderId) : null),
    [orderId]
  )
  const { records: orderRecords } = useRecords({
    recordIds: orderRecordId ? [orderRecordId] : [],
    enabled: !!orderRecordId,
  })
  const orderName = orderRecords[0]?.displayName ?? null

  // The baseline filter: this return's own lines, via the belongs_to rel,
  // the `documentLineFilters` idiom (money/ui/line-builder/line-values.ts),
  // reproduced here rather than imported since it is money's own construction
  // site and this card is deliberately standalone (plan §1).
  const filters = useMemo<ConditionGroup[]>(
    () => [
      {
        id: 'return-lines-baseline',
        logicalOperator: 'AND',
        conditions: [
          {
            id: 'return-lines-return',
            fieldId: 'return_line:return',
            operator: 'is',
            value: recordId,
          },
        ],
      },
    ],
    [recordId]
  )

  const {
    records,
    isLoading,
    isLoadingRecords,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    refresh,
    appendCreated,
    removeFromList,
  } = useRecordList<RecordMeta>({
    entityDefinitionId: entityDefinitionId ?? '',
    filters,
    sorting: RETURN_LINE_SORT,
    limit: RETURN_LINE_PAGE_SIZE,
    enabled: !!entityDefinitionId,
  })

  // Line counts are small (a handful): load every page eagerly, no
  // virtualized scroll.
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isLoading) fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, isLoading, fetchNextPage])

  const lineRecordIds = useMemo(
    () => (entityDefinitionId ? records.map((r) => toRecordId(entityDefinitionId, r.id)) : []),
    [entityDefinitionId, records]
  )

  const systemAttributeMap = useResourceStore((state) => state.systemAttributeMap)
  const lineFieldIds = useMemo(
    () =>
      RETURN_LINE_SYNC_ATTRS.map((attribute) => systemAttributeMap[attribute]).filter(
        (fieldId): fieldId is NonNullable<typeof fieldId> => !!fieldId
      ),
    [systemAttributeMap]
  )
  useFieldValueSyncer({
    recordIds: lineRecordIds,
    columnVisibility: NO_COLUMN_VISIBILITY,
    resourceFieldIds: lineFieldIds,
    enabled: lineRecordIds.length > 0 && lineFieldIds.length > 0,
  })

  const rowsContainerRef = useRef<HTMLDivElement>(null)

  const { drafts, lastAddedDraftId, addLine, updateDraft, pickPart, deleteDraft } =
    useReturnLineDrafts({
      entityDefinitionId,
      returnRecordId: recordId,
      onCreated: ({ recordId: createdRecordId }) =>
        appendCreated(parseRecordId(createdRecordId).entityInstanceId),
    })

  // Mod+Backspace delete, Mod+Shift+P photos, Mod+Shift+D notes: the row
  // itself listens for `LINE_ROW_ACTION_EVENT` on its col-0 cell.
  useLineRowActions<ReturnLineRowAction>({
    containerRef: rowsContainerRef,
    readOnly,
    bindings: [
      { hotkey: 'Mod+Backspace', action: 'delete' },
      { hotkey: 'Mod+Shift+P', action: 'photos' },
      { hotkey: 'Mod+Shift+D', action: 'notes' },
    ],
  })

  const handleDeleted = useCallback(
    (instanceId: string) => removeFromList(instanceId),
    [removeFromList]
  )

  const [sheetOpen, setSheetOpen] = useState(false)

  const handleAddedFromOrder = useCallback(() => {
    if (entityDefinitionId) getRecordStoreState().invalidateLists(entityDefinitionId)
    void utils.return.get.invalidate({ returnRecordId: recordId })
    refresh()
  }, [entityDefinitionId, utils, recordId, refresh])

  if (!entityDefinitionId) return null

  const rowCount = records.length + drafts.length
  const isEmpty = !isLoading && !isLoadingRecords && rowCount === 0

  return (
    <div className='flex flex-col gap-2'>
      {orderRecordId && !readOnly && (
        <div className='flex justify-end'>
          <Button variant='outline' size='xs' onClick={() => setSheetOpen(true)}>
            <Plus />
            Add from order
          </Button>
        </div>
      )}

      <LineGridFrame
        containerRef={rowsContainerRef}
        cols={RETURN_LINE_COLS}
        header={[
          {
            label: 'Part',
            addButton: !readOnly && (
              <Button
                variant='ghost'
                size='icon-xs'
                className='ml-1 size-5 rounded-md bg-primary-100 hover:bg-primary-200 dark:bg-background'
                onClick={addLine}
                aria-label='Add line'>
                <Plus className='size-3' />
              </Button>
            ),
          },
          { label: 'Qty', align: 'end' },
          { label: 'Condition' },
          { label: 'Fault' },
        ]}
        rowCount={rowCount}
        colCount={4}
        onAddRow={addLine}
        readOnly={readOnly}
        showEmpty={isEmpty}
        empty={
          <EmptySection
            className='border-transparent ring-0'
            title='Nothing recorded yet'
            description={
              orderName
                ? `Add what arrived from ${orderName}, or key a part by hand.`
                : 'This return names no order, so key the part that turned up on the dock.'
            }
          />
        }>
        {records.map((record, index) => (
          <ReturnLineRow
            key={record.id}
            recordId={toRecordId(entityDefinitionId, record.id)}
            rowIndex={index}
            readOnly={readOnly}
            onDeleted={handleDeleted}
          />
        ))}
        {drafts.map((draft, index) => (
          <ReturnLineDraftRow
            key={draft.draftId}
            draft={draft}
            rowIndex={records.length + index}
            autoFocus={draft.draftId === lastAddedDraftId}
            onUpdate={(patch) => updateDraft(draft.draftId, patch)}
            onPickPart={(partRecordId) => pickPart(draft.draftId, partRecordId)}
            onDelete={() => deleteDraft(draft.draftId)}
          />
        ))}
      </LineGridFrame>

      {orderRecordId && (
        <AddFromOrderSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          returnRecordId={recordId}
          orderRecordId={orderRecordId}
          entityDefinitionId={entityDefinitionId}
          onAdded={handleAddedFromOrder}
        />
      )}
    </div>
  )
}

export default ReturnLinesCard
