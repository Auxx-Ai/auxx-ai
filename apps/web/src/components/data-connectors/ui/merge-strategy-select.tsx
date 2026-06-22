// apps/web/src/components/data-connectors/ui/merge-strategy-select.tsx
'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'

/**
 * Per-field merge strategies offered once a target is bound. `manual_review` and
 * `ignore` stay in the schema/runtime (`FieldMergeStrategy`) but are not yet
 * surfaced — `manual_review` has no conflict-review queue and `ignore` has no
 * use until then. Re-add here when those land.
 */
export const MERGE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'overwrite', label: 'overwrite' },
  { value: 'fill_blank', label: 'fill-blank' },
  { value: 'connector_owned_only', label: 'owned-only' },
]

/**
 * The fixed-width merge-strategy picker shared by leaf and formula rows. A single
 * control so both surfaces stay visually identical and at a consistent x.
 */
export function MergeStrategySelect({
  value,
  onValueChange,
}: {
  value: string
  onValueChange: (value: string) => void
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger variant='transparent' size='sm' className='h-9 w-28 text-xs'>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {MERGE_OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
