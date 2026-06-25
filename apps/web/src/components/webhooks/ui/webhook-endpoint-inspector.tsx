// apps/web/src/components/webhooks/ui/webhook-endpoint-inspector.tsx
// Live delivery inspector for a generic inbound WebhookEndpoint. Listen-only (no synthetic
// send — the endpoint's public URL is the test path): toggle listening, watch deliveries
// land, expand a row to inspect its raw payload. Endpoint-scoped by default; pass `topic` to
// scope a binding view to matching deliveries, with a muted hint counting deliveries on other
// topics so a topic typo is visible. The row/expand/payload chrome comes from the shared
// TestEventList; this file only supplies the topic scoping + endpoint-specific seams.

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Radio, Sparkles } from 'lucide-react'
import { useMemo } from 'react'
import { TestEventList, TriggerEventInspector } from '~/components/workflow/shared/test-events'
import { CodeEditor, CodeLanguage } from '~/components/workflow/ui/code-editor'
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
  /** Forwarded to the underlying `Section` (e.g. to override padding in a scroll column). */
  className?: string
  /**
   * When supplied, each captured delivery gains a "Use shape as schema" action
   * (the Setup-topics page wires this to infer + store a topic's payload schema).
   * Omitted ⇒ read-only binding-check inspector (agent / DC / workflow embeds).
   */
  onUseEventShape?: (event: WebhookEndpointTestEvent) => void
}

export function WebhookEndpointInspector({
  endpointId,
  topic,
  title = 'Deliveries',
  description = 'Listen for live deliveries to this endpoint.',
  initialOpen = false,
  className,
  onUseEventShape,
}: WebhookEndpointInspectorProps) {
  const listener = useWebhookEndpointTestListener(endpointId)
  const scopedTopic = topic?.trim() || null

  return (
    <TriggerEventInspector<WebhookEndpointTestEvent>
      listener={listener}
      title={title}
      description={description}
      initialOpen={initialOpen}
      className={className}
      renderEvents={(events, onClear) => (
        <WebhookEndpointEventList
          events={events}
          onClear={onClear}
          scopedTopic={scopedTopic}
          onUseEventShape={onUseEventShape}
        />
      )}
    />
  )
}

/**
 * Thin wrapper over the shared {@link TestEventList}: applies the optional topic scope
 * (filtering deliveries + counting the rest for the hint footer) and supplies the
 * endpoint-specific seams (Radio icon, topic-badge title, payload `CodeEditor`, the
 * "Use shape as schema" action). The row/expand/payload chrome lives in the shared list.
 */
function WebhookEndpointEventList({
  events,
  onClear,
  scopedTopic,
  onUseEventShape,
}: {
  events: WebhookEndpointTestEvent[]
  onClear: () => void
  scopedTopic: string | null
  onUseEventShape?: (event: WebhookEndpointTestEvent) => void
}) {
  const { shown, otherCount } = useMemo(() => {
    if (!scopedTopic) return { shown: events, otherCount: 0 }
    const shown = events.filter((e) => e.topic === scopedTopic)
    return { shown, otherCount: events.length - shown.length }
  }, [events, scopedTopic])

  const footer =
    scopedTopic && otherCount > 0 ? (
      <OtherTopicsHint count={otherCount} topic={scopedTopic} />
    ) : undefined

  return (
    <TestEventList<WebhookEndpointTestEvent>
      events={shown}
      onClear={onClear}
      icon={<Radio className='size-4' />}
      countNoun={{ one: 'delivery', many: 'deliveries' }}
      emptyTitle={
        scopedTopic ? `No deliveries on "${scopedTopic}" yet` : 'No deliveries captured yet'
      }
      emptyDescription='Deliveries to this endpoint will appear here in real time.'
      footer={footer}
      renderTitle={(event) =>
        event.topic ? (
          <Badge variant='secondary' className='text-xs'>
            {event.topic}
          </Badge>
        ) : (
          <span className='text-xs text-muted-foreground'>(no topic)</span>
        )
      }
      renderMeta={(event) =>
        event.eventId ? <span className='max-w-32 truncate font-mono'>{event.eventId}</span> : null
      }
      renderDetail={(event) => (
        <CodeEditor
          language={CodeLanguage.json}
          value={JSON.stringify(event.triggerData, null, 2)}
          readOnly
          minHeight={120}
          title='PAYLOAD'
          gradientBorder={false}
        />
      )}
      renderActions={
        onUseEventShape
          ? (event) => (
              <div className='flex justify-end'>
                <Button variant='outline' size='xs' onClick={() => onUseEventShape(event)}>
                  <Sparkles />
                  Use shape as schema
                  {event.topic ? ` for "${event.topic}"` : ''}
                </Button>
              </div>
            )
          : undefined
      }
    />
  )
}

function OtherTopicsHint({ count, topic }: { count: number; topic: string }) {
  return (
    <p className='text-xs text-muted-foreground'>
      {count} other {count === 1 ? 'delivery' : 'deliveries'} to this endpoint on other topics (not
      matching <code>{topic}</code>).
    </p>
  )
}
