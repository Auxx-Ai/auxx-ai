// apps/web/src/components/workflow/hooks/use-webhook-test-listener.ts
import { useCallback } from 'react'
import { useWebhookTestStore } from '~/components/workflow/store/webhook-test-store'

export function useWebhookTestListener(workflowId: string) {
  const listener = useWebhookTestStore((state) => state.getListener(workflowId))
  const startListeningStore = useWebhookTestStore((state) => state.startListening)
  const stopListeningStore = useWebhookTestStore((state) => state.stopListening)
  const clearEventsStore = useWebhookTestStore((state) => state.clearEvents)

  const startListening = useCallback(() => {
    startListeningStore(workflowId)
  }, [workflowId, startListeningStore])

  const stopListening = useCallback(() => {
    stopListeningStore(workflowId)
  }, [workflowId, stopListeningStore])

  const clearEvents = useCallback(() => {
    clearEventsStore(workflowId)
  }, [workflowId, clearEventsStore])

  return {
    events: listener?.events || [],
    isListening: listener?.isListening || false,
    connectionStatus: listener?.connectionStatus || 'disconnected',
    startListening,
    stopListening,
    clearEvents,
  }
}
