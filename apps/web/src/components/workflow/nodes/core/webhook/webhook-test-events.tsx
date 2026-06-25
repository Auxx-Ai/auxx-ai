// apps/web/src/components/workflow/nodes/core/webhook/webhook-test-events.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { CheckCircle2, FileJson, XCircle } from 'lucide-react'
import { TestEventList } from '~/components/workflow/shared/test-events'
import { CodeEditor, CodeLanguage } from '~/components/workflow/ui/code-editor'
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
      renderTitle={(event) => (
        <span className='flex items-center gap-1.5'>
          <Badge variant={event.method === 'GET' ? 'secondary' : 'default'} className='text-xs'>
            {event.method}
          </Badge>
          {event.responseStatus != null &&
            (event.responseStatus >= 200 && event.responseStatus < 300 ? (
              <CheckCircle2 className='size-4 text-green-500' />
            ) : (
              <XCircle className='size-4 text-red-500' />
            ))}
        </span>
      )}
      renderDetail={(event) => (
        <>
          {Object.keys(event.query).length > 0 && (
            <CodeEditor
              language={CodeLanguage.json}
              value={JSON.stringify(event.query, null, 2)}
              readOnly
              minHeight={80}
              title='QUERY PARAMETERS'
              gradientBorder={false}
            />
          )}
          <CodeEditor
            language={CodeLanguage.json}
            value={JSON.stringify(event.headers, null, 2)}
            readOnly
            minHeight={80}
            title='HEADERS'
            gradientBorder={false}
          />
          {event.body != null && (
            <CodeEditor
              language={CodeLanguage.json}
              value={JSON.stringify(event.body, null, 2)}
              readOnly
              minHeight={120}
              title='BODY'
              gradientBorder={false}
            />
          )}
        </>
      )}
      renderActions={
        onUseAsSchema
          ? (event) =>
              event.method === 'POST' && event.body ? (
                <div className='flex justify-end'>
                  <Button variant='outline' size='xs' onClick={() => onUseAsSchema(event.body)}>
                    <FileJson />
                    Use as Schema Template
                  </Button>
                </div>
              ) : null
          : undefined
      }
    />
  )
}
