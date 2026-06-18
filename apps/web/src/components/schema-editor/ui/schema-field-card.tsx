// apps/web/src/components/schema-editor/ui/schema-field-card.tsx

import { typeLabelOf, typeValueOf } from '../draft-ops'
import type { SchemaFieldDraft } from '../schema-draft'

/**
 * Compact read row in SOG's plain-text style: bold name, lowercase type, a red
 * "Required" tag, and an inline (truncated) description. Single-line, so it's the
 * same height as the edit card — hovering swaps in place without shifting rows.
 * No chips, no icons — the visual language stays identical to the original editor.
 */
export function SchemaFieldCard({ row }: { row: SchemaFieldDraft }) {
  const typeLabel = typeLabelOf(typeValueOf(row))

  return (
    <div className='flex flex-col py-0.5'>
      <div className='flex h-7 items-center gap-x-1 pl-1 pr-0.5'>
        <div className='shrink-0 border border-transparent px-1 py-px font-semibold text-sm text-primary-800'>
          {row.name || 'field'}
        </div>
        <div className='shrink-0 px-1 py-0.5 text-xs text-muted-foreground'>{typeLabel}</div>
        {row.nullable && (
          <div className='shrink-0 px-1 py-0.5 text-[10px] text-muted-foreground'>nullable</div>
        )}
        {row.required && (
          <div className='shrink-0 px-1 py-0.5 font-medium text-[10px] text-bad-500 uppercase'>
            Required
          </div>
        )}
        {row.description && (
          <div className='min-w-0 truncate px-1 text-xs text-muted-foreground'>
            {row.description}
          </div>
        )}
      </div>
    </div>
  )
}
