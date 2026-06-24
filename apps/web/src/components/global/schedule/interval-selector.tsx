// apps/web/src/components/global/schedule/interval-selector.tsx
'use client'

import { InputGroup } from '@auxx/ui/components/input-group'
import {
  NumberInput,
  NumberInputArrows,
  NumberInputField as NumberInputFieldBase,
} from '@auxx/ui/components/input-number'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { VarEditorField } from '~/components/workflow/ui/input-editor/var-editor'

export type Interval = 'minutes' | 'hours' | 'days' | 'weeks'

// Mirrors MIN_SCHEDULE_INTERVAL_MINUTES (packages/lib cron-pattern). Hardcoded
// here to keep this client component free of the server-only lib barrel.
export const MIN_MINUTES = 5

/**
 * Lowest allowed value for a given unit — minutes are floored at `minMinutes`
 * (defaults to the generic {@link MIN_MINUTES}; connectors pass a coarser floor).
 */
export const minIntervalValue = (interval: Interval, minMinutes = MIN_MINUTES) =>
  interval === 'minutes' ? minMinutes : 1

interface IntervalSelectorProps {
  interval: Interval
  value: number
  onIntervalChange: (interval: Interval) => void
  onValueChange: (value: number) => void
  /** Minute-cadence floor; defaults to {@link MIN_MINUTES}. */
  minMinutes?: number
}

/**
 * Inline [Unit] [Number] selector matching the workflow scheduled trigger
 * look. Uses VarEditorField for the container styling and NumberInput +
 * NumberInputArrows for the value input — no ReactFlow context required.
 */
export function IntervalSelector({
  interval,
  value,
  onIntervalChange,
  onValueChange,
  minMinutes,
}: IntervalSelectorProps) {
  const minValue = minIntervalValue(interval, minMinutes)
  return (
    <VarEditorField className='py-0 pe-0 ps-0.5'>
      <div className='flex flex-row items-center gap-2'>
        <Select value={interval} onValueChange={(v) => onIntervalChange(v as Interval)}>
          <SelectTrigger size='sm' className='w-24'>
            <SelectValue placeholder='Select interval' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='minutes'>Minutes</SelectItem>
            <SelectItem value='hours'>Hours</SelectItem>
            <SelectItem value='days'>Days</SelectItem>
            <SelectItem value='weeks'>Weeks</SelectItem>
          </SelectContent>
        </Select>
        <div className='flex-1'>
          <NumberInput
            value={value}
            onValueChange={(v) => onValueChange(Math.max(minValue, v ?? minValue))}
            min={minValue}>
            <InputGroup className='bg-transparent! min-h-8 shadow-none ring-0 border-0 has-[[data-slot=input-group-control]:focus-visible]:ring-[0px]'>
              <NumberInputFieldBase className='text-start ps-0 placeholder:text-primary-400' />
              <NumberInputArrows />
            </InputGroup>
          </NumberInput>
        </div>
      </div>
    </VarEditorField>
  )
}
