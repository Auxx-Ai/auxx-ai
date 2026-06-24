// apps/web/src/components/connections/triggers/connection-webhook-test-section.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { Play, Radio } from 'lucide-react'
import { useCallback, useState } from 'react'
import { CodeEditor } from '~/components/schema-editor/ui/code-editor'
import Section from '~/components/workflow/ui/section'
import { ConnectionWebhookTestEvents } from './connection-webhook-test-events'
import { useConnectionWebhookTestListener } from './use-connection-webhook-test-listener'

interface ConnectionWebhookTestSectionProps {
  connectionId: string
  topic: string
}

export function ConnectionWebhookTestSection({
  connectionId,
  topic,
}: ConnectionWebhookTestSectionProps) {
  const { events, isListening, connectionStatus, startListening, stopListening, clearEvents } =
    useConnectionWebhookTestListener(connectionId, topic)

  const [showTestEditor, setShowTestEditor] = useState(false)
  const [testData, setTestData] = useState('{}')
  const [isSending, setIsSending] = useState(false)

  const handleSendTest = useCallback(async () => {
    let parsed: unknown
    try {
      parsed = JSON.parse(testData)
    } catch {
      toastError({ title: 'Invalid JSON', description: 'Please enter valid JSON data' })
      return
    }

    setIsSending(true)
    try {
      const res = await fetch(
        `/api/connection-webhooks/${connectionId}/${encodeURIComponent(topic)}/test`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ triggerData: parsed }),
        }
      )
      if (!res.ok) {
        const text = await res.text()
        toastError({ title: 'Failed to send test event', description: text })
      }
    } catch (error: any) {
      toastError({ title: 'Failed to send test event', description: error.message })
    } finally {
      setIsSending(false)
    }
  }, [testData, connectionId, topic])

  return (
    <Section
      title='Deliveries'
      description='Listen for incoming deliveries on this topic or send a manual test.'
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
            {isListening ? 'Listening...' : 'Listen for Deliveries'}
          </Button>

          <Button variant='outline' size='sm' onClick={() => setShowTestEditor(!showTestEditor)}>
            <Play />
            Send Test Delivery
          </Button>
        </div>

        {showTestEditor && (
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

        {(isListening || events.length > 0) && (
          <ConnectionWebhookTestEvents events={events} onClear={clearEvents} />
        )}
      </div>
    </Section>
  )
}
