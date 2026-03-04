// apps/web/src/components/workflow/nodes/core/app-trigger/app-trigger-test-events.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { TestEventList } from '~/components/workflow/shared/test-events'
import type { AppTriggerTestEvent } from './types'

interface AppTriggerTestEventsProps {
  events: AppTriggerTestEvent[]
  onClear: () => void
}

export function AppTriggerTestEvents({ events, onClear }: AppTriggerTestEventsProps) {
  return (
    <TestEventList<AppTriggerTestEvent>
      events={events}
      onClear={onClear}
      emptyTitle='No trigger events captured yet'
      emptyDescription='Trigger events from webhooks or manual tests will appear here'
      renderEventBadges={(event) => (
        <>
          <Badge variant={event.source === 'webhook' ? 'default' : 'secondary'} className='text-xs'>
            {event.source}
          </Badge>
          {event.eventId && (
            <span className='text-xs text-muted-foreground font-mono truncate max-w-32'>
              {event.eventId}
            </span>
          )}
        </>
      )}
      renderEventDetail={(event) => (
        <div>
          <h5 className='text-xs font-medium mb-1'>Trigger Data</h5>
          <pre className='text-xs bg-muted p-2 rounded overflow-x-auto max-h-48 overflow-y-auto'>
            {JSON.stringify(event.triggerData, null, 2)}
          </pre>
        </div>
      )}
    />
  )
}
