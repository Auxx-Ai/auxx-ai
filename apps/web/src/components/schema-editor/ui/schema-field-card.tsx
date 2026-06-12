// apps/web/src/components/schema-editor/ui/schema-field-card.tsx

import { pickerValueOf, typeLabelOf } from '../draft-ops'
import type { SchemaFieldDraft } from '../schema-draft'

/**
 * Compact read row in SOG's plain-text style: bold name, lowercase type, a red
 * "Required" tag, and the description on a muted second line. No chips, no
 * icons — the visual language stays identical to the original editor.
 */
export function SchemaFieldCard({ row }: { row: SchemaFieldDraft }) {
  const typeLabel = typeLabelOf(pickerValueOf(row))

  return (
    <div className='flex flex-col py-0.5'>
      <div className='flex h-7 items-center gap-x-1 pl-1 pr-0.5'>
        <div className='truncate border border-transparent px-1 py-px font-semibold text-sm text-primary-800'>
          {row.name || 'field'}
        </div>
        <div className='px-1 py-0.5 text-xs text-muted-foreground'>{typeLabel}</div>
        {row.nullable && (
          <div className='px-1 py-0.5 text-[10px] text-muted-foreground'>nullable</div>
        )}
        {row.required && (
          <div className='px-1 py-0.5 font-medium text-[10px] text-bad-500 uppercase'>Required</div>
        )}
      </div>
      {row.description && (
        <div className='truncate px-2 pb-1 text-xs text-muted-foreground'>{row.description}</div>
      )}
    </div>
  )
}
