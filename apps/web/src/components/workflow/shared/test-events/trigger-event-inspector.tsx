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
  /** Forwarded to the underlying `Section` wrapper (e.g. to override padding in a scroll column). */
  className?: string
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
  className,
  renderEvents,
  send,
}: TriggerEventInspectorProps<T>) {
  const { events, isListening, connectionStatus, startListening, stopListening, clearEvents } =
    listener

  const [showTestEditor, setShowTestEditor] = useState(false)
  const [testData, setTestData] = useState(() => send?.sampleData ?? '{}')
  const [isSending, setIsSending] = useState(false)

  // The body only has something to reveal while listening, once results exist, or when a
  // manual "Send Test Event" affordance is offered. With nothing to show, collapse the
  // section and drop the chevron. `userOpen` tracks manual collapse; starting to listen
  // makes the body available again and re-opens it automatically.
  const [userOpen, setUserOpen] = useState(initialOpen)
  const expandable = isListening || events.length > 0 || !!send
  const open = expandable && userOpen

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
      open={open}
      collapsible={expandable}
      onOpenChange={setUserOpen}
      // When non-collapsible, Section forces the Collapsible open, so its `data-[state=closed]:pb-0`
      // never fires and the bodyless header keeps a dead `pb-4`. Zero it via the inner data-slot.
      className={cn(className, !expandable && '[&_[data-slot=section]]:pb-0')}
      actions={
        // The button is the connection indicator — its label/pulse reflect the live SSE state
        // (idle → connecting → listening), so no separate status badge is needed.
        <Button
          variant='outline'
          size='xs'
          className={cn(
            isListening &&
              'bg-bad-200 hover:bg-bad-200 text-bad-500 hover:text-bad-500 border-bad-300'
          )}
          onClick={() => {
            if (isListening) {
              stopListening()
            } else {
              startListening()
              setUserOpen(true) // starting to listen always opens the section to reveal events
            }
          }}>
          {isListening ? (
            <span
              className={cn(
                'size-2.5 animate-pulse rounded-full',
                connectionStatus === 'connecting' ? 'bg-yellow-500' : 'bg-bad-500'
              )}
            />
          ) : (
            <Radio />
          )}
          {!isListening
            ? 'Listen for Events'
            : connectionStatus === 'connecting'
              ? 'Connecting…'
              : 'Listening…'}
        </Button>
      }>
      <div className='space-y-3'>
        {send && (
          <Button variant='outline' size='sm' onClick={() => setShowTestEditor(!showTestEditor)}>
            <Play />
            Send Test Event
          </Button>
        )}

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
