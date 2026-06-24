// apps/web/src/components/connections/triggers/connection-webhook-test-events.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { TestEventList } from '~/components/workflow/shared/test-events'
import type { ConnectionWebhookTestEvent } from './types'

interface ConnectionWebhookTestEventsProps {
  events: ConnectionWebhookTestEvent[]
  onClear: () => void
}

export function ConnectionWebhookTestEvents({ events, onClear }: ConnectionWebhookTestEventsProps) {
  return (
    <TestEventList<ConnectionWebhookTestEvent>
      events={events}
      onClear={onClear}
      emptyTitle='No deliveries captured yet'
      emptyDescription='Provider deliveries and manual tests for this topic will appear here'
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
          <h5 className='text-xs font-medium mb-1'>Payload</h5>
          <pre className='text-xs bg-muted p-2 rounded overflow-x-auto max-h-48 overflow-y-auto'>
            {JSON.stringify(event.triggerData, null, 2)}
          </pre>
        </div>
      )}
    />
  )
}
