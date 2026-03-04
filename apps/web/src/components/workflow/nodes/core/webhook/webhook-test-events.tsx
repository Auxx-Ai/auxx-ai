// apps/web/src/components/workflow/nodes/core/webhook/webhook-test-events.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { CheckCircle2, FileJson, XCircle } from 'lucide-react'
import { TestEventList } from '~/components/workflow/shared/test-events'
import type { WebhookTestEvent } from './types'

interface WebhookTestEventsProps {
  events: WebhookTestEvent[]
  onClear: () => void
  onUseAsSchema?: (body: any) => void
}

export function WebhookTestEvents({ events, onClear, onUseAsSchema }: WebhookTestEventsProps) {
  return (
    <TestEventList<WebhookTestEvent>
      events={events}
      onClear={onClear}
      emptyTitle='No webhook events captured yet'
      emptyDescription='Send a request to your test webhook URL to see it here'
      renderEventBadges={(event) => (
        <>
          <Badge variant={event.method === 'GET' ? 'secondary' : 'default'} className='text-xs'>
            {event.method}
          </Badge>
          {event.responseStatus != null &&
            (event.responseStatus >= 200 && event.responseStatus < 300 ? (
              <CheckCircle2 className='h-4 w-4 text-green-500' />
            ) : (
              <XCircle className='h-4 w-4 text-red-500' />
            ))}
        </>
      )}
      renderEventDetail={(event) => (
        <>
          {Object.keys(event.query).length > 0 && (
            <div>
              <h5 className='text-xs font-medium mb-1'>Query Parameters</h5>
              <pre className='text-xs bg-muted p-2 rounded overflow-x-auto'>
                {JSON.stringify(event.query, null, 2)}
              </pre>
            </div>
          )}
          <div>
            <h5 className='text-xs font-medium mb-1'>Headers</h5>
            <pre className='text-xs bg-muted p-2 rounded overflow-x-auto max-h-32 overflow-y-auto'>
              {JSON.stringify(event.headers, null, 2)}
            </pre>
          </div>
          {event.body && (
            <div>
              <h5 className='text-xs font-medium mb-1'>Body</h5>
              <pre className='text-xs bg-muted p-2 rounded overflow-x-auto max-h-48 overflow-y-auto'>
                {JSON.stringify(event.body, null, 2)}
              </pre>
            </div>
          )}
        </>
      )}
      renderEventActions={
        onUseAsSchema
          ? (event) =>
              event.method === 'POST' && event.body ? (
                <Button
                  variant='ghost'
                  size='xs'
                  onClick={() => onUseAsSchema(event.body)}
                  className='h-6 text-xs'>
                  <FileJson className='h-3 w-3 mr-1' />
                  Use as Schema Template
                </Button>
              ) : null
          : undefined
      }
    />
  )
}
