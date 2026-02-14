// apps/web/src/components/workflow/nodes/core/webhook/webhook-test-events.tsx

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { toastSuccess } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { formatDistanceToNow } from 'date-fns'
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  FileJson,
  XCircle,
} from 'lucide-react'
import React, { useState } from 'react'
import type { WebhookTestEvent } from '~/components/workflow/store/webhook-test-store'

interface WebhookTestEventsProps {
  events: WebhookTestEvent[]
  onClear: () => void
  onUseAsSchema?: (body: any) => void
}

export function WebhookTestEvents({ events, onClear, onUseAsSchema }: WebhookTestEventsProps) {
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set())

  const toggleExpanded = (eventId: string) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev)
      if (next.has(eventId)) {
        next.delete(eventId)
      } else {
        next.add(eventId)
      }
      return next
    })
  }

  const copyEventData = (event: WebhookTestEvent) => {
    navigator.clipboard.writeText(JSON.stringify(event, null, 2))
    toastSuccess({ title: 'Event data copied' })
  }

  const getStatusIcon = (status?: number) => {
    if (!status) return null
    if (status >= 200 && status < 300) {
      return <CheckCircle2 className='h-4 w-4 text-green-500' />
    }
    return <XCircle className='h-4 w-4 text-red-500' />
  }

  const getMethodBadgeVariant = (method: string) => {
    return method === 'GET' ? 'secondary' : 'default'
  }

  if (events.length === 0) {
    return (
      <div className='text-center py-8 text-muted-foreground'>
        <p className='text-sm'>No webhook events captured yet</p>
        <p className='text-xs mt-1'>Send a request to your test webhook URL to see it here</p>
      </div>
    )
  }

  return (
    <div className='space-y-2'>
      <div className='flex items-center justify-between mb-2'>
        <span className='text-xs text-muted-foreground'>
          {events.length} event{events.length !== 1 ? 's' : ''} captured
        </span>
        <Button variant='ghost' size='xs' onClick={onClear} className='h-6'>
          Clear all
        </Button>
      </div>

      <div className='space-y-2 max-h-96 overflow-y-auto'>
        {events.map((event) => {
          const isExpanded = expandedEvents.has(event.id)

          return (
            <div key={event.id} className='border rounded-lg bg-background'>
              <div
                className='flex items-center justify-between p-3 cursor-pointer hover:bg-muted/50'
                onClick={() => toggleExpanded(event.id)}>
                <div className='flex items-center gap-2 flex-1'>
                  <button className='p-0.5'>
                    {isExpanded ? (
                      <ChevronDown className='h-4 w-4' />
                    ) : (
                      <ChevronRight className='h-4 w-4' />
                    )}
                  </button>

                  <Badge variant={getMethodBadgeVariant(event.method)} className='text-xs'>
                    {event.method}
                  </Badge>

                  {getStatusIcon(event.responseStatus)}

                  <span className='text-xs text-muted-foreground flex items-center gap-1'>
                    <Clock className='h-3 w-3' />
                    {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
                  </span>

                  {event.responseTime && (
                    <span className='text-xs text-muted-foreground'>{event.responseTime}ms</span>
                  )}
                </div>

                <Button
                  variant='ghost'
                  size='xs'
                  onClick={(e) => {
                    e.stopPropagation()
                    copyEventData(event)
                  }}
                  className='h-6'>
                  <Copy className='h-3 w-3' />
                </Button>
              </div>

              {isExpanded && (
                <div className='border-t px-3 py-2 space-y-2'>
                  {/* Query Parameters */}
                  {Object.keys(event.query).length > 0 && (
                    <div>
                      <h5 className='text-xs font-medium mb-1'>Query Parameters</h5>
                      <pre className='text-xs bg-muted p-2 rounded overflow-x-auto'>
                        {JSON.stringify(event.query, null, 2)}
                      </pre>
                    </div>
                  )}

                  {/* Headers */}
                  <div>
                    <h5 className='text-xs font-medium mb-1'>Headers</h5>
                    <pre className='text-xs bg-muted p-2 rounded overflow-x-auto max-h-32 overflow-y-auto'>
                      {JSON.stringify(event.headers, null, 2)}
                    </pre>
                  </div>

                  {/* Body */}
                  {event.body && (
                    <div>
                      <div className='flex items-center justify-between mb-1'>
                        <h5 className='text-xs font-medium'>Body</h5>
                        {onUseAsSchema && event.method === 'POST' && (
                          <Button
                            variant='ghost'
                            size='xs'
                            onClick={() => onUseAsSchema(event.body)}
                            className='h-6 text-xs'>
                            <FileJson className='h-3 w-3 mr-1' />
                            Use as Schema Template
                          </Button>
                        )}
                      </div>
                      <pre className='text-xs bg-muted p-2 rounded overflow-x-auto max-h-48 overflow-y-auto'>
                        {JSON.stringify(event.body, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
