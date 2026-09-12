// apps/web/src/components/returns/ui/return-line-row.tsx
'use client'

// One `return_line` row on the return lines card (money/tasks/56 §4.2), built
// entirely from the document-agnostic `~/components/line-grid` kit, no
// import from `money/`, matching the owner's "reuse the line grid, don't
// reinvent it" call at the top of that plan.
//
// Two rows share one cell layout (`ReturnLineCells` below): {@link
// ReturnLineRow} for a persisted record, store-bound through `useSystemValues`
// / `useSaveFieldValue` (the same door `LineRow` and the Details panel write
// through, which is where `return-line-over-return-guard.ts` is registered),
// and {@link ReturnLineDraftRow} for a local-only draft
// (`use-return-line-drafts.ts`) whose cells write to local state until the
// part pick materializes the record. Mirrors how money's `LineRow` /
// `DraftLineRow` share `LinePartCellView` / `QuantityCellView`.
//
// Row anatomy: Part (the kit's `PartCell`, a return line's identity IS its
// part) / Qty / Condition / Fault. Menu (real rows only): Inspection notes
// (⇧D, swaps the part cell for a rich-text editor), Photos (⇧P,
// `LinePhotoPopover` reused verbatim from money), Open line (drill via
// `useOpenRecord`, hidden outside a record stack), then Delete, confirming
// first when the line's teardown checklist (`return_line_part_lines`) has
// entries, since that relationship cascades silently otherwise. A draft's
// menu is just Delete: there is no record yet for the rest to act on.

import { FieldType } from '@auxx/database/enums'
import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import { DropdownMenuItem, DropdownMenuSeparator } from '@auxx/ui/components/dropdown-menu'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRowButton } from '@auxx/ui/components/tree-row'
import { Camera, Check, ExternalLink, FileText } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { LINE_ROW_ACTION_EVENT } from '~/components/line-grid/hooks/use-line-row-actions'
import { CellInput } from '~/components/line-grid/ui/cell-input'
import { LineGridRow } from '~/components/line-grid/ui/line-grid-row'
import { LineRowMenu, MenuShortcut } from '~/components/line-grid/ui/line-row-menu'
import { PartCell } from '~/components/line-grid/ui/part-cell'
import { LinePhotoPopover } from '~/components/money/ui/line-builder/line-photo-popover'
import { useOpenRecord } from '~/components/records/record-drill-panels'
import { useSystemField } from '~/components/resources/hooks/use-field'
import { useRecords } from '~/components/resources/hooks/use-records'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { parseRecordId, type RecordId } from '~/components/resources/store'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import type { ReturnLineDraft } from '../hooks/use-return-line-drafts'

/** Part (fills) · Qty · Condition · Fault, plan §4.1. No grip, no reorder. */
export const RETURN_LINE_COLS = 'minmax(10rem, 1fr) 4.5rem 9rem 9rem'

/** Row-action shortcuts dispatched on the focused row's col-0 cell. */
export type ReturnLineRowAction = 'delete' | 'photos' | 'notes'

const RETURN_LINE_ATTRS = [
  'return_line_part',
  'return_line_line_item',
  'return_line_quantity',
  'return_line_condition_grade',
  'return_line_liability',
  'return_line_inspection_notes',
  'return_line_photos',
  'return_line_part_lines',
] as const

/** Narrow a SINGLE_SELECT's `onChange` payload: the picker calls back with an array. */
function firstSelectValue(value: unknown): string | null {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : null
  return typeof value === 'string' ? value : null
}

/** Integer-only, non-negative: `return_line.quantity`'s `validation: { min: 0 }`. */
function parseQuantity(raw: string): { ok: true; value: number } | { ok: false } {
  const trimmed = raw.trim()
  if (trimmed === '') return { ok: false }
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed < 0) return { ok: false }
  return { ok: true, value: parsed }
}

/**
 * The four cells shared by a persisted row and a draft row, the money
 * `LineRow`/`DraftLineRow` precedent, built on the kit's `PartCell` and
 * `CellInput` (money/tasks/56 §3.6-3.7) instead of hand-rolled inputs.
 */
function ReturnLineCells({
  rowIndex,
  partRecordId,
  quantity,
  conditionGrade,
  liability,
  readOnly,
  disabled = false,
  onPickPart,
  onCommitQuantity,
  onCommitCondition,
  onCommitLiability,
  partChips,
  partMenu,
  partEditor,
  containerRef,
}: {
  rowIndex: number
  partRecordId: RecordId | null
  quantity: number
  conditionGrade: string | null
  liability: string | null
  readOnly: boolean
  /** True while a draft's create is in flight (the row is briefly non-interactive). */
  disabled?: boolean
  onPickPart: (recordId: RecordId | null) => void
  onCommitQuantity: (next: number) => void
  onCommitCondition: (next: string | null) => void
  onCommitLiability: (next: string | null) => void
  partChips?: ReactNode
  partMenu?: ReactNode
  partEditor?: ReactNode
  containerRef: React.RefObject<HTMLDivElement | null>
}) {
  const conditionField = useSystemField('return_line_condition_grade')
  const liabilityField = useSystemField('return_line_liability')

  return (
    <LineGridRow
      rowIndex={rowIndex}
      cols={RETURN_LINE_COLS}
      grip={null}
      cells={[
        {
          node: (
            <PartCell
              partAttribute='return_line_part'
              partRecordId={partRecordId}
              readOnly={readOnly || disabled}
              containerRef={containerRef}
              onPickPart={onPickPart}
              chips={partChips}
              menu={partMenu}
              editor={partEditor}
            />
          ),
          className: 'min-w-0',
        },
        {
          node: (
            <CellInput<number>
              value={quantity}
              readOnly={readOnly || disabled}
              align='end'
              inputMode='numeric'
              flashInvalid
              ariaLabel='Quantity'
              className='px-2'
              format={(value) => String(value)}
              parse={parseQuantity}
              onCommit={onCommitQuantity}
            />
          ),
        },
        {
          node: (
            <FieldInputAdapter
              fieldType={FieldType.SINGLE_SELECT}
              fieldOptions={conditionField?.options}
              triggerProps={{ className: 'h-7 w-full border-none bg-transparent px-1 shadow-none' }}
              value={conditionGrade}
              onChange={(value) => onCommitCondition(firstSelectValue(value))}
              placeholder={conditionField?.placeholder ?? 'Select condition'}
              disabled={readOnly || disabled}
            />
          ),
        },
        {
          node: (
            <FieldInputAdapter
              fieldType={FieldType.SINGLE_SELECT}
              fieldOptions={liabilityField?.options}
              triggerProps={{ className: 'h-7 w-full border-none bg-transparent px-1 shadow-none' }}
              value={liability}
              onChange={(value) => onCommitLiability(firstSelectValue(value))}
              placeholder={liabilityField?.placeholder ?? 'Select liability'}
              disabled={readOnly || disabled}
            />
          ),
        },
      ]}
    />
  )
}

/**
 * A persisted `return_line` row, reads through `useSystemValues`, writes
 * through `useSaveFieldValue` (plan §4.3: the store, not the router).
 */
export function ReturnLineRow({
  recordId,
  rowIndex,
  readOnly,
  onDeleted,
}: {
  recordId: RecordId
  rowIndex: number
  readOnly: boolean
  /** Drop the row from the record store's list caches, the money `deleteLine` precedent. */
  onDeleted: (instanceId: string) => void
}) {
  const { values } = useSystemValues(recordId, RETURN_LINE_ATTRS, { autoFetch: false })
  const partRecordId = extractRelationshipRecordIds(values.return_line_part)[0] ?? null
  const lineItemRecordId = extractRelationshipRecordIds(values.return_line_line_item)[0] ?? null
  const quantity = typeof values.return_line_quantity === 'number' ? values.return_line_quantity : 0
  const conditionGrade =
    typeof values.return_line_condition_grade === 'string'
      ? values.return_line_condition_grade
      : null
  const liability =
    typeof values.return_line_liability === 'string' ? values.return_line_liability : null
  const inspectionNotes =
    typeof values.return_line_inspection_notes === 'string'
      ? values.return_line_inspection_notes
      : null
  const photoCount = Array.isArray(values.return_line_photos) ? values.return_line_photos.length : 0
  const partLineCount = Array.isArray(values.return_line_part_lines)
    ? values.return_line_part_lines.length
    : 0

  const { saveFieldValue } = useSaveFieldValue()
  const { mutateAsync: deleteMutateAsync } = api.record.delete.useMutation()
  const [confirm, ConfirmDialog] = useConfirm()
  const [photosOpen, setPhotosOpen] = useState(false)
  const [editingNotes, setEditingNotes] = useState(false)
  const openRecord = useOpenRecord()
  const photosField = useSystemField('return_line_photos')

  const { records: lineItemRecords } = useRecords({
    recordIds: lineItemRecordId ? [lineItemRecordId] : [],
    enabled: !!lineItemRecordId,
  })
  const lineItemName = lineItemRecords[0]?.displayName ?? null

  const rootRef = useRef<HTMLDivElement>(null)

  const handleDelete = useCallback(async () => {
    if (partLineCount > 0) {
      const confirmed = await confirm({
        title: 'Delete this line?',
        description: `This line has ${partLineCount} component${
          partLineCount === 1 ? '' : 's'
        } on its teardown checklist; they are deleted with it.`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (!confirmed) return
    }
    const instanceId = parseRecordId(recordId).entityInstanceId
    try {
      await deleteMutateAsync({ recordId })
      onDeleted(instanceId)
    } catch (error) {
      toastError({
        title: 'Error deleting line',
        description: error instanceof Error ? error.message : 'Could not delete the line',
      })
    }
  }, [partLineCount, confirm, recordId, deleteMutateAsync, onDeleted])

  // Row-action shortcuts (`use-line-row-actions.ts`) arrive as a CustomEvent
  // on the enclosing col-0 cell, one listener bound once, same contract as
  // money's `LinePartCellView`. The listener survives the editor swap below
  // because the col-0 wrapper (rendered by `LineGridRow`) never unmounts.
  const actionRef = useRef<(action: ReturnLineRowAction) => void>(() => {})
  actionRef.current = (action) => {
    if (action === 'delete') void handleDelete()
    if (action === 'photos' && photosField) setPhotosOpen(true)
    if (action === 'notes') setEditingNotes(true)
  }
  useEffect(() => {
    const cell = rootRef.current?.closest('[data-line-col]')
    if (!cell) return
    const onAction = (event: Event) =>
      actionRef.current((event as CustomEvent<ReturnLineRowAction>).detail)
    cell.addEventListener(LINE_ROW_ACTION_EVENT, onAction)
    return () => cell.removeEventListener(LINE_ROW_ACTION_EVENT, onAction)
  }, [])

  const partChips = (
    <>
      {lineItemRecordId ? (
        <span className='shrink-0 truncate text-muted-foreground text-xs'>
          {lineItemName ?? 'Sold line'}
        </span>
      ) : (
        <span className='shrink-0 text-muted-foreground text-xs italic'>No sold line</span>
      )}
      {photosField && (
        <LinePhotoPopover
          recordId={recordId}
          field={photosField}
          photoCount={photoCount}
          readOnly={readOnly}
          open={photosOpen}
          onOpenChange={setPhotosOpen}
        />
      )}
    </>
  )

  const partMenu = readOnly ? undefined : (
    <LineRowMenu onDelete={() => void handleDelete()}>
      <DropdownMenuItem onSelect={() => setEditingNotes(true)}>
        <FileText />
        Inspection notes
        <MenuShortcut keys={['⇧', 'D']} />
      </DropdownMenuItem>
      {photosField && (
        <DropdownMenuItem onSelect={() => setPhotosOpen(true)}>
          <Camera />
          Photos
          <MenuShortcut keys={['⇧', 'P']} />
        </DropdownMenuItem>
      )}
      {openRecord && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => openRecord(recordId)}>
            <ExternalLink />
            Open line
          </DropdownMenuItem>
        </>
      )}
    </LineRowMenu>
  )

  const partEditor = editingNotes ? (
    <div ref={rootRef} className='flex min-w-0 flex-1 items-center gap-1 py-1'>
      <div className='min-w-0 flex-1'>
        <FieldInputAdapter
          fieldType={FieldType.RICH_TEXT}
          value={inspectionNotes}
          onChange={(value) =>
            saveFieldValue(recordId, 'return_line_inspection_notes', value, FieldType.RICH_TEXT)
          }
          placeholder='What the inspection found'
        />
      </div>
      <TreeRowButton persistent tooltipText='Done' onClick={() => setEditingNotes(false)}>
        <Check />
      </TreeRowButton>
    </div>
  ) : undefined

  return (
    <>
      <ReturnLineCells
        rowIndex={rowIndex}
        partRecordId={partRecordId}
        quantity={quantity}
        conditionGrade={conditionGrade}
        liability={liability}
        readOnly={readOnly}
        containerRef={rootRef}
        onPickPart={(next) => {
          // `allowClearPart` stays off (the default): `return_line.part` is
          // `required: true`, so a clear on a persisted row is a rejected write.
          if (next) saveFieldValue(recordId, 'return_line_part', next, FieldType.RELATIONSHIP)
        }}
        onCommitQuantity={(next) =>
          saveFieldValue(recordId, 'return_line_quantity', next, FieldType.NUMBER)
        }
        onCommitCondition={(next) =>
          saveFieldValue(recordId, 'return_line_condition_grade', next, FieldType.SINGLE_SELECT)
        }
        onCommitLiability={(next) =>
          saveFieldValue(recordId, 'return_line_liability', next, FieldType.SINGLE_SELECT)
        }
        partChips={partChips}
        partMenu={partMenu}
        partEditor={partEditor}
      />
      <ConfirmDialog />
    </>
  )
}

/**
 * A local-only draft row (`use-return-line-drafts.ts`), the same cells as
 * {@link ReturnLineRow}, wired to the draft's local state instead of the
 * store. No sold-line chip (a hand-added draft never carries one), no photos,
 * no inspection notes, none of those exist before the record does. Its part
 * pick is what materializes the row.
 */
export function ReturnLineDraftRow({
  draft,
  rowIndex,
  autoFocus = false,
  onUpdate,
  onPickPart,
  onDelete,
}: {
  draft: ReturnLineDraft
  rowIndex: number
  /** Focus the part picker on mount, set for the just-added draft. */
  autoFocus?: boolean
  onUpdate: (patch: Partial<ReturnLineDraft>) => void
  onPickPart: (partRecordId: RecordId) => void
  onDelete: () => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)

  // The kit's `PartCell` has no `autoFocus` affordance (money/tasks/56's kit
  // never needed one, money's name cell owns its own focus state). Composing
  // around it: `containerRef` is the same node the row-action listener below
  // binds off, so it doubles as the handle to focus the picker trigger once,
  // on mount, for a freshly added draft.
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus once, on mount only
  useEffect(() => {
    if (!autoFocus) return
    const trigger = rootRef.current?.querySelector('[role="combobox"]') as HTMLElement | null
    trigger?.focus()
  }, [])

  const actionRef = useRef<(action: ReturnLineRowAction) => void>(() => {})
  actionRef.current = (action) => {
    // Only delete makes sense before the record exists: photos/notes have
    // nowhere to attach to yet.
    if (action === 'delete') onDelete()
  }
  useEffect(() => {
    const cell = rootRef.current?.closest('[data-line-col]')
    if (!cell) return
    const onAction = (event: Event) =>
      actionRef.current((event as CustomEvent<ReturnLineRowAction>).detail)
    cell.addEventListener(LINE_ROW_ACTION_EVENT, onAction)
    return () => cell.removeEventListener(LINE_ROW_ACTION_EVENT, onAction)
  }, [])

  return (
    <ReturnLineCells
      rowIndex={rowIndex}
      partRecordId={draft.partRecordId}
      quantity={draft.quantity}
      conditionGrade={draft.conditionGrade}
      liability={draft.liability}
      readOnly={false}
      disabled={draft.creating}
      containerRef={rootRef}
      onPickPart={(next) => {
        if (next) onPickPart(next)
      }}
      onCommitQuantity={(next) => onUpdate({ quantity: next })}
      onCommitCondition={(next) => onUpdate({ conditionGrade: next })}
      onCommitLiability={(next) => onUpdate({ liability: next })}
      partChips={
        <span className='shrink-0 text-muted-foreground text-xs italic'>No sold line</span>
      }
      partMenu={<LineRowMenu onDelete={onDelete}>{null}</LineRowMenu>}
    />
  )
}
