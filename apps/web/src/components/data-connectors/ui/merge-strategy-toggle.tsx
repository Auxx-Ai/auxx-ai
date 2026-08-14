// apps/web/src/components/data-connectors/ui/merge-strategy-toggle.tsx
'use client'

import { Badge, type BadgeProps } from '@auxx/ui/components/badge'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'

type BadgeVariant = BadgeProps['variant']

/**
 * Per-field merge strategies offered once a target is bound, each carrying its
 * badge color + tooltip copy. `manual_review` and `ignore` stay in the
 * schema/runtime (`FieldMergeStrategy`) but are not yet surfaced — `manual_review`
 * has no conflict-review queue and `ignore` has no use until then.
 */
const MERGE_STRATEGIES: Array<{
  value: string
  label: string
  variant: BadgeVariant
  description: string
}> = [
  {
    value: 'overwrite',
    label: 'Always update',
    variant: 'default',
    description:
      'Always keep this field at the latest synced value. On a multi-value field only the synced value is updated — other values are kept.',
  },
  {
    value: 'fill_blank',
    label: 'Only if empty',
    variant: 'sky',
    description:
      'Only fill this in when the field is empty; never replace an existing value. On a multi-value field, only when the list is empty.',
  },
  {
    value: 'connector_owned_only',
    label: 'Keep manual edits',
    variant: 'emerald',
    description: 'Only update values this sync created; leave manually-edited values untouched.',
  },
]

/**
 * The merge-strategy control, rendered as a click-to-cycle badge (mirroring the
 * mapping's owned/contributing toggle) rather than a dropdown. Each click advances
 * to the next strategy; the tooltip explains the current one.
 */
export function MergeStrategyToggle({
  value,
  onValueChange,
}: {
  value: string
  onValueChange: (value: string) => void
}) {
  const idx = Math.max(
    0,
    MERGE_STRATEGIES.findIndex((s) => s.value === value)
  )
  const current = MERGE_STRATEGIES[idx]!
  const cycle = () => onValueChange(MERGE_STRATEGIES[(idx + 1) % MERGE_STRATEGIES.length]!.value)

  return (
    <SimpleTooltip
      side='left'
      delayDuration={500}
      contentComponent={
        <div className='max-w-xs'>
          <div className='font-semibold'>{current.label}</div>
          <div className='text-muted-foreground'>{current.description}</div>
        </div>
      }>
      <button type='button' onClick={cycle} className='inline-flex shrink-0 items-center'>
        <Badge variant={current.variant} size='xs' className='cursor-pointer'>
          {current.label}
        </Badge>
      </button>
    </SimpleTooltip>
  )
}
