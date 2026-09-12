// apps/web/src/components/line-grid/ui/part-cell.tsx
'use client'

// The picker cell's ANATOMY, generalized out of money's `LinePartCellView`
// (line-builder/line-rows.tsx) - the leading cell of a buy-side line, whose
// docblock states the load-bearing idea this extraction exists to carry
// forward: **a line's identity IS its part**, so the pick is what
// materializes a draft row, exactly as a catalog pick does on the sell side.
//
// What's generic: the relation picker, the standing chip run after it, one
// `⋯` menu slot, and a single swap slot that REPLACES the whole cell (picker
// + chips + menu) with an editor - money's description/match-key/GL-account
// editors, none of which this file knows about. What stays in money:
// description, match key, GL account and weight all become `chips`/`editor`
// state money's own `LinePartCellView` owns and composes here.
//
// The return lines card (money/tasks/56 §4.2) is the second consumer: its
// leading cell IS this, with a "sold line" chip and its own smaller menu.

import { FieldType } from '@auxx/database/enums'
import { cn } from '@auxx/ui/lib/utils'
import type { ReactNode, RefObject } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import type { RecordId } from '~/components/resources'
import { useSystemField } from '~/components/resources/hooks/use-field'

export interface PartCellProps {
  /** The relation attribute this cell's picker edits (e.g. `purchase_order_line_part`, `return_line_part`). */
  partAttribute: string
  partRecordId: RecordId | null
  readOnly: boolean
  /**
   * Show the picker's clear (`X`) affordance - off by default, and that
   * default is a constraint, not caution.
   *
   * 🛑 A relation declared `required: true` (a purchase order line's part, a
   * return line's part) cannot lose it - the write is rejected - so the `X`
   * must not render on a PERSISTED row. Only a caller whose row is
   * unpersisted (a draft blob, materialized on the first commit) or whose
   * entity allows a part-less row may turn this on.
   */
  allowClearPart?: boolean
  onPickPart: (recordId: RecordId | null) => void
  /**
   * Standing controls rendered after the picker (or after the plain label in
   * readOnly mode), before `menu` - shown once the concept they represent is
   * SET, never a permanent second row.
   */
  chips?: ReactNode
  /** The row's one `⋯`, rendered only in editable mode (never alongside the readOnly label). */
  menu?: ReactNode
  /**
   * The cell's single swap slot: when non-null it REPLACES the entire cell
   * (picker, chips AND menu) - today's description / match-key / GL editors.
   * `undefined`/`null` = at rest.
   */
  editor?: ReactNode
  /** Attached to the "at rest, editable" wrapper - money hangs its row-action-event listener off this. */
  containerRef?: RefObject<HTMLDivElement | null>
  className?: string
}

/**
 * The leading, part-identified cell: a relation picker where a sell-side line
 * would put its free-text name. See the file doc for what's generic here vs
 * what a consumer (money, returns) composes around it.
 */
export function PartCell({
  partAttribute,
  partRecordId,
  readOnly,
  allowClearPart = false,
  onPickPart,
  chips,
  menu,
  editor,
  containerRef,
  className,
}: PartCellProps) {
  const partField = useSystemField(partAttribute)

  if (editor != null) return <>{editor}</>

  if (readOnly) {
    return (
      <div className={cn('flex min-w-0 flex-1 items-center gap-1.5 py-1', className)}>
        <span className='min-w-0 truncate px-1 text-sm'>
          {partField?.label ?? 'Part'}
          {partRecordId ? '' : ' -'}
        </span>
        {chips}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={cn('flex min-w-0 flex-1 items-center gap-1.5 py-1', className)}>
      <FieldInputAdapter
        fieldType={partField?.fieldType ?? FieldType.RELATIONSHIP}
        fieldOptions={partField?.options}
        // `PickerTrigger` takes no data attributes, so the grid's nav hook
        // matches this trigger on `[role="combobox"]` instead - see
        // `use-line-nav.ts`.
        triggerProps={{
          className: 'h-7 min-w-0 flex-1 border-none bg-transparent px-1 shadow-none',
          // The `X` beside the chevron - `PickerTrigger` draws it, and
          // `MultiRelationInput`'s `handleClearAll` sends `[]`, which arrives
          // below as `onPickPart(null)`.
          showClear: allowClearPart,
        }}
        value={partRecordId ? [partRecordId] : []}
        onChange={(next) => {
          const ids = next as RecordId[]
          onPickPart(ids[0] ?? null)
        }}
        placeholder='Select part...'
      />
      {chips}
      {menu}
    </div>
  )
}
