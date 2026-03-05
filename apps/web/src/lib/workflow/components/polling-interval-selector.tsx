// apps/web/src/lib/workflow/components/polling-interval-selector.tsx

'use client'

import { Label } from '@auxx/ui/components/label'
import { Section } from '@auxx/ui/components/section'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { useNodeDataUpdate } from '~/components/workflow/hooks/use-node-data-update'

const INTERVAL_OPTIONS = [
  { value: '1', label: 'Every 1 minute' },
  { value: '2', label: 'Every 2 minutes' },
  { value: '5', label: 'Every 5 minutes' },
  { value: '10', label: 'Every 10 minutes' },
  { value: '15', label: 'Every 15 minutes' },
  { value: '30', label: 'Every 30 minutes' },
  { value: '60', label: 'Every hour' },
]

interface PollingIntervalSelectorProps {
  nodeId: string
  data: any
  defaultInterval?: number
  minInterval?: number
}

export function PollingIntervalSelector({
  nodeId,
  data,
  defaultInterval = 5,
  minInterval = 1,
}: PollingIntervalSelectorProps) {
  const { handleNodeDataUpdateWithSync } = useNodeDataUpdate()

  const currentInterval = data?.config?.polling?.intervalMinutes ?? defaultInterval
  const filteredOptions = INTERVAL_OPTIONS.filter((opt) => Number(opt.value) >= minInterval)

  const handleChange = (value: string) => {
    const interval = Number(value)
    handleNodeDataUpdateWithSync({
      id: nodeId,
      data: {
        config: {
          ...data?.config,
          polling: {
            ...data?.config?.polling,
            intervalMinutes: interval,
          },
        },
      },
    })
  }

  return (
    <Section title='Polling'>
      <div className='space-y-1.5'>
        <Label>Check interval</Label>
        <Select value={String(currentInterval)} onValueChange={handleChange}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {filteredOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </Section>
  )
}
