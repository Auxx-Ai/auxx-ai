// apps/web/src/components/workflow/shared/test-events/trigger-event-inspector.tsx
// Shared live-delivery inspector shell: a listen toggle + connection indicator + event
// list, optionally with a synthetic "Send test event" editor. Both the app-trigger
// inspector (with send) and the generic WebhookEndpoint inspector (listen-only) render
// through this — the shell is source-agnostic, the caller wires the listener + renderer.

'use client'

import { Button } from '@auxx/ui/components/button'
import { Section } from '@auxx/ui/components/section'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { Play, Radio } from 'lucide-react'
import { type ReactNode, useCallback, useState } from 'react'
import { CodeEditor } from '~/components/schema-editor/ui/code-editor'
import type { BaseTestEvent, ConnectionStatus } from './types'

/** The slice of `useTestEventListener`'s return this shell needs. */
export interface TriggerEventListenerState<T extends BaseTestEvent> {
  events: T[]
  isListening: boolean
  connectionStatus: ConnectionStatus
  startListening: () => void
  stopListening: () => void
  clearEvents: () => void
}

interface TriggerEventInspectorProps<T extends BaseTestEvent> {
  listener: TriggerEventListenerState<T>
  title?: string
  description?: string
  initialOpen?: boolean
  /** Renders the captured events (e.g. the shared `TestEventList`). */
  renderEvents: (events: T[], onClear: () => void) => ReactNode
  /**
   * Synthetic test-send affordance. OMIT for listen-only sources (generic webhook
   * endpoints — the real URL is the test path). When present, shows a JSON editor seeded
   * with `sampleData` and POSTs the parsed payload through `onSend`.
   */
  send?: {
    sampleData: string
    onSend: (parsed: Record<string, unknown>) => Promise<void>
  }
}

export function TriggerEventInspector<T extends BaseTestEvent>({
  listener,
  title = 'Deliveries',
  description = 'Listen for incoming events in real time.',
  initialOpen = true,
  renderEvents,
  send,
}: TriggerEventInspectorProps<T>) {
  const { events, isListening, connectionStatus, startListening, stopListening, clearEvents } =
    listener

  const [showTestEditor, setShowTestEditor] = useState(false)
  const [testData, setTestData] = useState(() => send?.sampleData ?? '{}')
  const [isSending, setIsSending] = useState(false)

  const handleSendTest = useCallback(async () => {
    if (!send) return
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(testData)
    } catch {
      toastError({ title: 'Invalid JSON', description: 'Please enter valid JSON data' })
      return
    }
    setIsSending(true)
    try {
      await send.onSend(parsed)
    } catch (error: any) {
      toastError({ title: 'Failed to send test event', description: error.message })
    } finally {
      setIsSending(false)
    }
  }, [send, testData])

  return (
    <Section
      title={title}
      description={description}
      initialOpen={initialOpen}
      actions={
        <div className='flex items-center gap-2'>
          <div
            className={cn(
              'size-2 rounded-full',
              connectionStatus === 'connected'
                ? 'bg-green-500'
                : connectionStatus === 'connecting'
                  ? 'bg-yellow-500 animate-pulse'
                  : 'bg-gray-400'
            )}
          />
          <span className='text-xs text-muted-foreground'>
            {connectionStatus === 'connected'
              ? 'Listening'
              : connectionStatus === 'connecting'
                ? 'Connecting...'
                : 'Disconnected'}
          </span>
        </div>
      }>
      <div className='space-y-3'>
        <div className='flex items-center gap-2'>
          <Button
            variant='outline'
            size='sm'
            className={cn(
              isListening &&
                'bg-bad-200 hover:bg-bad-200 text-bad-500 hover:text-bad-500 border-bad-300'
            )}
            onClick={() => (isListening ? stopListening() : startListening())}>
            {isListening ? (
              <span className='size-2.5 rounded-full bg-bad-500 animate-pulse' />
            ) : (
              <Radio />
            )}
            {isListening ? 'Listening...' : 'Listen for Events'}
          </Button>

          {send && (
            <Button variant='outline' size='sm' onClick={() => setShowTestEditor(!showTestEditor)}>
              <Play />
              Send Test Event
            </Button>
          )}
        </div>

        {send && showTestEditor && (
          <div className='space-y-2'>
            <CodeEditor
              value={testData}
              onUpdate={setTestData}
              className='h-40 rounded-lg border'
            />
            <Button
              variant='default'
              size='sm'
              onClick={handleSendTest}
              loading={isSending}
              loadingText='Sending...'>
              Send
            </Button>
          </div>
        )}

        {(isListening || events.length > 0) && renderEvents(events, clearEvents)}
      </div>
    </Section>
  )
}
