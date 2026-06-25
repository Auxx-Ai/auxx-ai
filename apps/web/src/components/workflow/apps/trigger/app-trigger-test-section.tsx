// apps/web/src/components/workflow/apps/trigger/app-trigger-test-section.tsx

'use client'

import { useMemo } from 'react'
import { useAppTriggerTestListener } from '~/components/workflow/hooks/use-app-trigger-test-listener'
import { TriggerEventInspector } from '~/components/workflow/shared/test-events'
import type { WorkflowBlockOutput } from '~/components/workflow/types/block-types'
import { AppTriggerTestEvents } from './app-trigger-test-events'

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

interface AppTriggerTestSectionProps {
  installationId: string
  triggerId: string
  schema?: { outputs?: Record<string, WorkflowBlockOutput> }
  /** Forwarded to the underlying `Section` (e.g. to override padding in a scroll column). */
  className?: string
}

/**
 * App-trigger delivery inspector — live listen + synthetic "Send test event" (seeded from the
 * trigger's declared output schema). A thin wrapper over the shared {@link TriggerEventInspector}.
 */
export function AppTriggerTestSection({
  installationId,
  triggerId,
  schema,
  className,
}: AppTriggerTestSectionProps) {
  const listener = useAppTriggerTestListener(installationId, triggerId)
  const sampleData = useMemo(
    () => JSON.stringify(buildSampleData(schema?.outputs), null, 2),
    [schema?.outputs]
  )

  return (
    <TriggerEventInspector
      listener={listener}
      title='Test Trigger'
      description='Listen for incoming trigger events or send a manual test.'
      className={className}
      renderEvents={(events, onClear) => <AppTriggerTestEvents events={events} onClear={onClear} />}
      send={{
        sampleData,
        onSend: async (parsed) => {
          const res = await fetch(`/api/app-triggers/${installationId}/${triggerId}/test`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ triggerData: parsed }),
          })
          if (!res.ok) throw new Error(await res.text())
        },
      }}
    />
  )
}
