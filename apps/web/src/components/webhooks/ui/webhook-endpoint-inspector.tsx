// apps/web/src/components/webhooks/ui/webhook-endpoint-inspector.tsx
// Live delivery inspector for a generic inbound WebhookEndpoint. Listen-only (no synthetic
// send — the endpoint's public URL is the test path): toggle listening, watch deliveries
// land, expand a row to inspect its raw payload. Endpoint-scoped by default; pass `topic` to
// scope a binding view to matching deliveries, with a muted hint counting deliveries on other
// topics so a topic typo is visible. Rows render as TreeRows with the payload inside the
// expandable (mirrors components/evals/ui/eval-tool-responses.tsx).

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { formatDistanceToNow } from 'date-fns'
import { Clock, Radio, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { TriggerEventInspector } from '~/components/workflow/shared/test-events'
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const { shown, otherCount } = useMemo(() => {
    if (!scopedTopic) return { shown: events, otherCount: 0 }
    const shown = events.filter((e) => e.topic === scopedTopic)
    return { shown, otherCount: events.length - shown.length }
  }, [events, scopedTopic])

  if (shown.length === 0) {
    return (
      <div className='space-y-2'>
        <div className='py-8 text-center text-muted-foreground'>
          <p className='text-sm'>
            {scopedTopic ? `No deliveries on "${scopedTopic}" yet` : 'No deliveries captured yet'}
          </p>
          <p className='mt-1 text-xs'>Deliveries to this endpoint will appear here in real time.</p>
        </div>
        {scopedTopic && otherCount > 0 && (
          <OtherTopicsHint count={otherCount} topic={scopedTopic} />
        )}
      </div>
    )
  }

  return (
    <div className='space-y-2'>
      <div className='flex items-center justify-between'>
        <span className='text-xs text-muted-foreground'>
          {shown.length} {shown.length === 1 ? 'delivery' : 'deliveries'} captured
        </span>
        <Button variant='ghost' size='xs' className='h-6' onClick={onClear}>
          Clear all
        </Button>
      </div>

      <div className='max-h-96 space-y-0.5 overflow-y-auto'>
        {shown.map((event) => (
          <TreeRow
            key={event.id}
            icon={<Radio className='size-4' />}
            title={
              event.topic ? (
                <Badge variant='secondary' className='text-xs'>
                  {event.topic}
                </Badge>
              ) : (
                <span className='text-xs text-muted-foreground'>(no topic)</span>
              )
            }
            secondary={
              <span className='flex items-center gap-1.5 text-xs text-muted-foreground'>
                <Clock className='size-3' />
                {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
                {event.eventId && (
                  <span className='max-w-32 truncate font-mono'>{event.eventId}</span>
                )}
              </span>
            }
            expandable
            isOpen={expanded.has(event.id)}
            onToggleOpen={() => toggle(event.id)}>
            <div className='space-y-2 py-1.5 pe-2 ps-12'>
              <CodeEditor
                language={CodeLanguage.json}
                value={JSON.stringify(event.triggerData, null, 2)}
                readOnly
                minHeight={120}
                title='PAYLOAD'
                gradientBorder={false}
              />
              {onUseEventShape && (
                <div className='flex justify-end'>
                  <Button variant='outline' size='xs' onClick={() => onUseEventShape(event)}>
                    <Sparkles />
                    Use shape as schema
                    {event.topic ? ` for "${event.topic}"` : ''}
                  </Button>
                </div>
              )}
            </div>
          </TreeRow>
        ))}
      </div>

      {scopedTopic && otherCount > 0 && <OtherTopicsHint count={otherCount} topic={scopedTopic} />}
    </div>
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
