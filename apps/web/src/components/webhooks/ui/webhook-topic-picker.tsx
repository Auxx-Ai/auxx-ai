// apps/web/src/components/webhooks/ui/webhook-topic-picker.tsx
'use client'

import type { WebhookEndpointTopic } from '@auxx/database'
import type { SelectOption } from '@auxx/types/custom-field'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { generateId } from '@auxx/utils/generateId'
import { ChevronsUpDown } from 'lucide-react'
import { type ReactNode, useCallback, useMemo, useState } from 'react'
import { MultiSelectPicker } from '~/components/pickers/multi-select-picker'
import { api } from '~/trpc/react'
import { useWebhookEndpoint } from '../hooks/use-webhook-endpoint'

interface WebhookTopicPickerProps {
  endpointId: string
  /** Selected topic key(s). Single-select reads/writes `value[0]`. */
  value: string[]
  onChange: (keys: string[]) => void
  /** Multi-select (checkboxes) vs single-select (radio, closes on pick). */
  multi?: boolean
  disabled?: boolean
  placeholder?: string
  /** Custom trigger; defaults to an outline button summarizing the selection. */
  children?: ReactNode
}

/**
 * Picks topic key(s) declared on a {@link WebhookEndpoint}, with inline create + manage
 * (rename/delete) that persist back to the endpoint's `topics`. Used wherever an endpoint
 * is consumed — agent triggers, data-connector stream bindings, workflow nodes. The option
 * `value` is the topic **key** (the matched string), so the selection stored by the consumer
 * is unchanged in shape from the old free-text input.
 */
export function WebhookTopicPicker({
  endpointId,
  value,
  onChange,
  multi = false,
  disabled = false,
  placeholder = 'Select or add a topic…',
  children,
}: WebhookTopicPickerProps) {
  const [open, setOpen] = useState(false)
  const { data: endpoint } = api.webhookEndpoint.get.useQuery({ id: endpointId })
  const { update } = useWebhookEndpoint()
  const utils = api.useUtils()

  const topics = useMemo<WebhookEndpointTopic[]>(() => endpoint?.topics ?? [], [endpoint])
  const options = useMemo<SelectOption[]>(
    () => topics.map((t) => ({ value: t.key, label: t.name ?? t.key })),
    [topics]
  )

  // Map the picker's edited options back to the topic model — preserve existing
  // entries (id/schema/source) by key, mint new ones, drop removed ones.
  const persistOptions = useCallback(
    (next: SelectOption[]) => {
      const byKey = new Map(topics.map((t) => [t.key, t]))
      const topicsNext: WebhookEndpointTopic[] = next.map((opt) => {
        const existing = byKey.get(opt.value)
        const name = opt.label !== opt.value ? opt.label : undefined
        return existing ? { ...existing, name } : { id: generateId(), key: opt.value, name }
      })
      update.mutate(
        { id: endpointId, topics: topicsNext },
        { onSuccess: () => void utils.webhookEndpoint.get.invalidate({ id: endpointId }) }
      )
    },
    [topics, update, endpointId, utils]
  )

  const handleChange = useCallback(
    (keys: string[]) => {
      onChange(keys)
    },
    [onChange]
  )

  const summary = multi
    ? value.length > 0
      ? `${value.length} topic${value.length === 1 ? '' : 's'}`
      : placeholder
    : (value[0] ?? placeholder)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        {children ?? (
          <Button variant='outline' size='sm' className='w-full justify-between font-normal'>
            <span className={value.length === 0 ? 'text-muted-foreground' : undefined}>
              {summary}
            </span>
            <ChevronsUpDown className='text-muted-foreground' />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className='w-[280px] p-0' align='start'>
        <MultiSelectPicker
          options={options}
          value={value}
          onChange={handleChange}
          onOptionsChange={persistOptions}
          onSelectSingle={() => !multi && setOpen(false)}
          multi={multi}
          useValueAsLabel
          placeholder='Search or add a topic…'
          manageLabel='Manage topics'
          disabled={disabled}
        />
      </PopoverContent>
    </Popover>
  )
}
