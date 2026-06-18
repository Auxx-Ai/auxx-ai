// apps/web/src/components/data-connectors/ui/schedule-section.tsx
'use client'

import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { Section } from '@auxx/ui/components/section'
import { toastError } from '@auxx/ui/components/toast'
import { Clock } from 'lucide-react'
import { useState } from 'react'
import {
  type ScheduledState,
  ScheduleEditor,
  scheduledConfigFromState,
  scheduledStateFromConfig,
} from '~/components/global/schedule'
import { api } from '~/trpc/react'

type Connector = NonNullable<ReturnType<typeof api.dataConnector.getById.useQuery>['data']>

type SyncBehavior = 'manual' | 'scheduled' | 'webhook'

interface ScheduleSectionProps {
  connector: Connector
}

/**
 * Schedule section — a segmented control over the connector's single
 * `syncBehavior` (Manual · Scheduled · Webhook), NOT a list of triggers (05 §5).
 * Scheduled reveals the shared `ScheduleEditor` round-tripping `scheduleConfig`;
 * the floor is coarse (hours/days). Webhook is a later placeholder.
 */
export function ScheduleSection({ connector }: ScheduleSectionProps) {
  const utils = api.useUtils()
  const [behavior, setBehavior] = useState<SyncBehavior>(
    (connector.syncBehavior as SyncBehavior) ?? 'manual'
  )
  const [schedule, setSchedule] = useState<ScheduledState>(() =>
    scheduledStateFromConfig(connector.scheduleConfig as Record<string, unknown> | null)
  )

  const update = api.dataConnector.update.useMutation({
    onSuccess: () => void utils.dataConnector.getById.invalidate({ id: connector.id }),
    onError: (e) => toastError({ title: 'Could not save schedule', description: e.message }),
  })

  const handleBehaviorChange = (next: SyncBehavior) => {
    setBehavior(next)
    if (next === 'manual') {
      update.mutate({ id: connector.id, syncBehavior: 'manual', scheduleConfig: null })
    } else if (next === 'scheduled') {
      const config = scheduledConfigFromState(schedule)
      if (config)
        update.mutate({ id: connector.id, syncBehavior: 'scheduled', scheduleConfig: config })
    } else {
      update.mutate({ id: connector.id, syncBehavior: 'webhook', scheduleConfig: null })
    }
  }

  const handleScheduleChange = (next: ScheduledState) => {
    setSchedule(next)
    const config = scheduledConfigFromState(next)
    if (config)
      update.mutate({ id: connector.id, syncBehavior: 'scheduled', scheduleConfig: config })
  }

  return (
    <Section
      title='Schedule'
      icon={<Clock className='size-4' />}
      initialOpen
      collapsible={false}
      description='How often this connector syncs.'>
      <div className='flex flex-col gap-4 px-1'>
        <RadioTab
          value={behavior}
          onValueChange={(v) => handleBehaviorChange(v as SyncBehavior)}
          size='sm'>
          <RadioTabItem value='manual' size='sm'>
            Manual
          </RadioTabItem>
          <RadioTabItem value='scheduled' size='sm'>
            Scheduled
          </RadioTabItem>
          <RadioTabItem value='webhook' size='sm'>
            Webhook
          </RadioTabItem>
        </RadioTab>

        {behavior === 'manual' && (
          <p className='text-sm text-muted-foreground'>
            Sync only runs from the “Sync now” action in the header.
          </p>
        )}

        {behavior === 'scheduled' && (
          <div className='flex flex-col gap-3'>
            <ScheduleEditor value={schedule} onChange={handleScheduleChange} />
            <p className='text-xs text-muted-foreground'>
              Minimum cadence is hourly — connectors don’t sync more often than once an hour.
            </p>
          </div>
        )}

        {behavior === 'webhook' && (
          <div className='rounded-lg border border-dashed p-4 text-sm text-muted-foreground'>
            Webhook delivery (a connector URL + signing secret) is coming soon.
            {/* TODO(webhook): render the webhook URL + signing-secret panel (05 §5). */}
          </div>
        )}
      </div>
    </Section>
  )
}
