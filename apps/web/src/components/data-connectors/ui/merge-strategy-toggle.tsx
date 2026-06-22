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
    label: 'overwrite',
    variant: 'default',
    description: 'Always replace the target value with the synced value.',
  },
  {
    value: 'fill_blank',
    label: 'fill-blank',
    variant: 'sky',
    description: 'Only write when the target is empty; never replace an existing value.',
  },
  {
    value: 'connector_owned_only',
    label: 'owned-only',
    variant: 'emerald',
    description: 'Only update values this connector wrote; leave manually-edited values untouched.',
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
          <div className='font-semibold capitalize'>{current.label}</div>
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
