// apps/web/src/components/kb/ui/editor/sync-frequency-picker.tsx
'use client'

import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'

/**
 * The shared agent/workflow frequency model (subset). `null` here means "manual only".
 * Minutes is intentionally omitted — the floor is hourly (enforced server-side too).
 */
export interface ScheduleConfig {
  triggerInterval: 'hours' | 'days' | 'weeks'
  timeBetweenTriggers: {
    hours?: number
    days?: number
    weeks?: number
    isConstant?: boolean
  }
}

interface SyncFrequencyPickerProps {
  value: ScheduleConfig | null
  onChange: (next: ScheduleConfig | null) => void
}

type Interval = ScheduleConfig['triggerInterval']

/** Read the "every N" count out of a config for the active interval. */
function countOf(config: ScheduleConfig): number {
  const raw = config.timeBetweenTriggers[config.triggerInterval]
  return typeof raw === 'number' && raw > 0 ? raw : 1
}

function buildConfig(interval: Interval, count: number): ScheduleConfig {
  return {
    triggerInterval: interval,
    timeBetweenTriggers: { [interval]: Math.max(1, count), isConstant: true },
  }
}

/**
 * Minimal sync-cadence picker for knowledge sources: "Manual only" or "Every N
 * hours/days/weeks". Emits a ScheduledTriggerConfig the source scheduler turns into a
 * BullMQ cron, or null for manual. Reuses the shared frequency model, not the
 * workflow var-editor (which is overkill for a source).
 */
export function SyncFrequencyPicker({ value, onChange }: SyncFrequencyPickerProps) {
  const mode = value ? value.triggerInterval : 'manual'
  const count = value ? countOf(value) : 1

  const handleModeChange = (next: string) => {
    if (next === 'manual') {
      onChange(null)
      return
    }
    onChange(buildConfig(next as Interval, count))
  }

  return (
    <div className='flex flex-col gap-1.5'>
      <Label>Sync frequency</Label>
      <div className='flex items-center gap-2'>
        {value && (
          <>
            <span className='text-muted-foreground text-sm'>Every</span>
            <Input
              type='number'
              min={1}
              value={count}
              onChange={(e) =>
                onChange(
                  buildConfig(value.triggerInterval, Number.parseInt(e.target.value, 10) || 1)
                )
              }
              className='w-16'
            />
          </>
        )}
        <Select value={mode} onValueChange={handleModeChange}>
          <SelectTrigger className='flex-1'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='manual'>Manual only</SelectItem>
            <SelectItem value='hours'>Hour{count === 1 ? '' : 's'}</SelectItem>
            <SelectItem value='days'>Day{count === 1 ? '' : 's'}</SelectItem>
            <SelectItem value='weeks'>Week{count === 1 ? '' : 's'}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <p className='text-muted-foreground text-xs'>
        {value
          ? 'The source re-syncs automatically on this cadence.'
          : 'Sync only when you click Sync now.'}
      </p>
    </div>
  )
}
