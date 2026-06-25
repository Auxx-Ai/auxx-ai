// apps/web/src/components/webhooks/ui/webhook-endpoint-inspector.tsx
// Live delivery inspector for a generic inbound WebhookEndpoint. Listen-only (no synthetic
// send — the endpoint's public URL is the test path): toggle listening, watch deliveries
// land, inspect raw payloads. Endpoint-scoped by default; pass `topic` to scope a binding
// view to matching deliveries, with a muted hint counting deliveries on other topics so a
// topic typo is visible.

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { useMemo } from 'react'
import { TestEventList, TriggerEventInspector } from '~/components/workflow/shared/test-events'
import {
  useWebhookEndpointTestListener,
  type WebhookEndpointTestEvent,
} from '../hooks/use-webhook-endpoint-events'

interface WebhookEndpointInspectorProps {
  endpointId: string
  /** When set, only deliveries whose extracted topic matches are shown (binding-scoped). */
  topic?: string
  title?: string
  description?: string
  initialOpen?: boolean
}

export function WebhookEndpointInspector({
  endpointId,
  topic,
  title = 'Deliveries',
  description = 'Listen for live deliveries to this endpoint.',
  initialOpen = false,
}: WebhookEndpointInspectorProps) {
  const listener = useWebhookEndpointTestListener(endpointId)
  const scopedTopic = topic?.trim() || null

  return (
    <TriggerEventInspector<WebhookEndpointTestEvent>
      listener={listener}
      title={title}
      description={description}
      initialOpen={initialOpen}
      renderEvents={(events, onClear) => (
        <WebhookEndpointEventList events={events} onClear={onClear} scopedTopic={scopedTopic} />
      )}
    />
  )
}

function WebhookEndpointEventList({
  events,
  onClear,
  scopedTopic,
}: {
  events: WebhookEndpointTestEvent[]
  onClear: () => void
  scopedTopic: string | null
}) {
  const { shown, otherCount } = useMemo(() => {
    if (!scopedTopic) return { shown: events, otherCount: 0 }
    const shown = events.filter((e) => e.topic === scopedTopic)
    return { shown, otherCount: events.length - shown.length }
  }, [events, scopedTopic])

  return (
    <div className='space-y-2'>
      <TestEventList<WebhookEndpointTestEvent>
        events={shown}
        onClear={onClear}
        emptyTitle={
          scopedTopic ? `No deliveries on "${scopedTopic}" yet` : 'No deliveries captured yet'
        }
        emptyDescription='Deliveries to this endpoint will appear here in real time.'
        renderEventBadges={(event) => (
          <>
            {event.topic ? (
              <Badge variant='secondary' className='text-xs'>
                {event.topic}
              </Badge>
            ) : null}
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
      {scopedTopic && otherCount > 0 && (
        <p className='text-xs text-muted-foreground'>
          {otherCount} other {otherCount === 1 ? 'delivery' : 'deliveries'} to this endpoint on
          other topics (not matching <code>{scopedTopic}</code>).
        </p>
      )}
    </div>
  )
}
