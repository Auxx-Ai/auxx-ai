// apps/web/src/components/workflow/nodes/core/app-trigger/app-trigger-test-section.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { Play, Radio } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useAppTriggerTestListener } from '~/components/workflow/hooks/use-app-trigger-test-listener'
import Section from '~/components/workflow/ui/section'
import type { WorkflowBlockOutput } from '~/lib/workflow/types'
import { AppTriggerTestEvents } from './app-trigger-test-events'

interface AppTriggerTestSectionProps {
  installationId: string
  triggerId: string
  schema?: { outputs?: Record<string, WorkflowBlockOutput> }
}

/**
 * Builds a sample JSON object from schema output fields for the test editor.
 */
function buildSampleData(outputs?: Record<string, WorkflowBlockOutput>): Record<string, unknown> {
  if (!outputs) return {}
  const sample: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(outputs)) {
    switch (field.type) {
      case 'string':
        sample[key] = ''
        break
      case 'number':
        sample[key] = 0
        break
      case 'boolean':
        sample[key] = false
        break
      case 'array':
        sample[key] = []
        break
      case 'object':
        sample[key] = field.properties ? buildSampleData(field.properties) : {}
        break
      default:
        sample[key] = null
    }
  }
  return sample
}

export function AppTriggerTestSection({
  installationId,
  triggerId,
  schema,
}: AppTriggerTestSectionProps) {
  const { events, isListening, connectionStatus, startListening, stopListening, clearEvents } =
    useAppTriggerTestListener(installationId, triggerId)

  const [showTestEditor, setShowTestEditor] = useState(false)
  const [testData, setTestData] = useState(() =>
    JSON.stringify(buildSampleData(schema?.outputs), null, 2)
  )
  const [isSending, setIsSending] = useState(false)

  const handleSendTest = useCallback(async () => {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(testData)
    } catch {
      toastError({ title: 'Invalid JSON', description: 'Please enter valid JSON data' })
      return
    }

    setIsSending(true)
    try {
      const res = await fetch(`/api/app-triggers/${installationId}/${triggerId}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggerData: parsed }),
      })
      if (!res.ok) {
        const text = await res.text()
        toastError({ title: 'Failed to send test event', description: text })
      }
    } catch (error: any) {
      toastError({ title: 'Failed to send test event', description: error.message })
    } finally {
      setIsSending(false)
    }
  }, [testData, installationId, triggerId])

  return (
    <Section
      title='Test Trigger'
      description='Listen for incoming trigger events or send a manual test.'
      actions={
        <div className='flex items-center gap-2'>
          <div
            className={cn(
              'h-2 w-2 rounded-full',
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

          <Button variant='outline' size='sm' onClick={() => setShowTestEditor(!showTestEditor)}>
            <Play />
            Send Test Event
          </Button>
        </div>

        {showTestEditor && (
          <div className='space-y-2'>
            <Textarea
              value={testData}
              onChange={(e) => setTestData(e.target.value)}
              placeholder='{"key": "value"}'
              className='font-mono text-xs min-h-24'
              rows={6}
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
          <AppTriggerTestEvents events={events} onClear={clearEvents} />
        )}
      </div>
    </Section>
  )
}
