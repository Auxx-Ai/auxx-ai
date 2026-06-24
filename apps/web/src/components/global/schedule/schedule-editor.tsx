// apps/web/src/components/global/schedule/schedule-editor.tsx

'use client'

import { Field, FieldLabel } from '@auxx/ui/components/field'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { CronEditor } from './cron-editor'
import { IntervalSelector, minIntervalValue } from './interval-selector'
import type { ScheduledMode, ScheduledState } from './scheduled-config'

interface ScheduleEditorProps {
  value: ScheduledState
  onChange: (next: ScheduledState) => void
  /** Minute-cadence floor passed to the simple {@link IntervalSelector}. */
  minMinutes?: number
}

/**
 * Simple/Cron schedule editor — a `RadioTab` mode toggle over the
 * {@link IntervalSelector} (simple cadence) and {@link CronEditor} (raw cron).
 * Round-trips a {@link ScheduledState}; serialize it with
 * `scheduledConfigFromState`. Shared by the agent trigger dialog and the
 * connector Schedule section.
 */
export function ScheduleEditor({ value, onChange, minMinutes }: ScheduleEditorProps) {
  const setMode = (mode: ScheduledMode) =>
    onChange({
      ...value,
      mode,
      customCron: mode === 'cron' ? value.customCron || '0 * * * *' : value.customCron,
    })

  return (
    <>
      <Field orientation='horizontal'>
        <FieldLabel>Mode</FieldLabel>
        <RadioTab value={value.mode} onValueChange={(v) => setMode(v as ScheduledMode)} size='sm'>
          <RadioTabItem value='simple' size='sm'>
            Simple
          </RadioTabItem>
          <RadioTabItem value='cron' size='sm'>
            Cron
          </RadioTabItem>
        </RadioTab>
      </Field>

      {value.mode === 'cron' ? (
        <CronEditor
          value={value.customCron}
          onChange={(customCron) => onChange({ ...value, customCron })}
        />
      ) : (
        <IntervalSelector
          interval={value.interval}
          value={value.value}
          minMinutes={minMinutes}
          onIntervalChange={(interval) =>
            onChange({
              ...value,
              interval,
              value: Math.max(minIntervalValue(interval, minMinutes), value.value),
            })
          }
          onValueChange={(v) => onChange({ ...value, value: v })}
        />
      )}
    </>
  )
}
