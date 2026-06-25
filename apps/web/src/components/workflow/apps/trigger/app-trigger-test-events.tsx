// apps/web/src/components/workflow/apps/trigger/app-trigger-test-events.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { TestEventList } from '~/components/workflow/shared/test-events'
import { CodeEditor, CodeLanguage } from '~/components/workflow/ui/code-editor'
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
      renderTitle={(event) => (
        <Badge variant={event.source === 'webhook' ? 'default' : 'secondary'} className='text-xs'>
          {event.source}
        </Badge>
      )}
      renderMeta={(event) =>
        event.eventId ? <span className='max-w-32 truncate font-mono'>{event.eventId}</span> : null
      }
      renderDetail={(event) => (
        <CodeEditor
          language={CodeLanguage.json}
          value={JSON.stringify(event.triggerData, null, 2)}
          readOnly
          minHeight={120}
          title='TRIGGER DATA'
          gradientBorder={false}
        />
      )}
    />
  )
}
