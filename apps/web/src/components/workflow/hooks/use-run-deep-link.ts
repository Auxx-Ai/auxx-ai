// apps/web/src/components/workflow/hooks/use-run-deep-link.ts

import { toastError } from '@auxx/ui/components/toast'
import { useQueryState } from 'nuqs'
import { useEffect, useRef } from 'react'
import { api } from '~/trpc/react'
import { usePanelStore } from '../store/panel-store'
import { useRunStore } from '../store/run-store'

/**
 * Hydrates a historical run from the `runId` URL query param.
 *
 * The run selection lives only in zustand, which is wiped when the editor
 * unmounts (e.g. switching Editor → Executions → Editor). This hook restores it
 * from the URL on mount: it fetches the run, loads it into the run store
 * read-only, and opens the run panel — mirroring what RunHistory does on click.
 *
 * Mounted once inside the editor (under WorkflowStoreProvider). The zustand
 * store never touches the router; components that dismiss a run clear the param.
 */
export function useRunDeepLink() {
  const [runId, setRunId] = useQueryState('runId', { history: 'replace' })
  const activeRun = useRunStore((state) => state.activeRun)
  const isRunning = useRunStore((state) => state.isRunning)
  const showPrevious = useRunStore((state) => state.showPrevious)
  const openedForRef = useRef<string | null>(null)

  // Fetch only when the param points at a run we don't already have loaded and
  // we're not mid-run. React Query caches, so remounts rehydrate instantly.
  const needsFetch = !!runId && activeRun?.id !== runId && !isRunning

  const { data, error } = api.workflow.getWorkflowRun.useQuery(
    { runId: runId! },
    { enabled: needsFetch }
  )

  // Load the fetched run into the store read-only
  useEffect(() => {
    if (data && needsFetch) {
      showPrevious(data as any)
    }
  }, [data, needsFetch, showPrevious])

  // Open the run panel once when the deep-linked run becomes active (covers both
  // the fetch path and the direct handoff from the Executions drawer). Guarded so
  // it doesn't fight the user re-closing the panel.
  useEffect(() => {
    if (runId && activeRun?.id === runId) {
      if (openedForRef.current !== runId) {
        openedForRef.current = runId
        usePanelStore.getState().openOverlay('run')
      }
    } else if (!runId) {
      openedForRef.current = null
    }
  }, [runId, activeRun?.id])

  // Run not found (deleted, or belongs to another workflow): drop the param
  useEffect(() => {
    if (error) {
      toastError({
        title: 'Run unavailable',
        description: 'This run could not be loaded.',
      })
      setRunId(null)
    }
  }, [error, setRunId])
}
