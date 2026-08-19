// apps/web/src/components/workflow/hooks/use-create-workflow.ts
'use client'

import { toastError } from '@auxx/ui/components/toast'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { useAnalytics } from '~/hooks/use-analytics'
import { api } from '~/trpc/react'

interface UseCreateWorkflowResult {
  /** Create an empty workflow and route straight to its builder. */
  createWorkflow: () => Promise<void>
  /** True from the click until the builder route takes over. */
  isCreating: boolean
}

/**
 * Create-from-scratch: no dialog, no form. The server mints the next free
 * "Untitled workflow" name and a starter icon (see
 * `WorkflowService.resolveWorkflowIdentity`), and the user renames from the
 * builder header's Settings button whenever they care to.
 *
 * Mirrors `useAgentMutations().createAgent` + `CreateAgentButton` — the same
 * "land on the canvas, name it later" flow agents already ship.
 */
export function useCreateWorkflow(): UseCreateWorkflowResult {
  const router = useRouter()
  const utils = api.useUtils()
  const posthog = useAnalytics()
  const [isRedirecting, setIsRedirecting] = useState(false)

  const create = api.workflow.create.useMutation({
    onError: (error) =>
      toastError({ title: 'Failed to create workflow', description: error.message }),
  })

  const createWorkflow = useCallback(async () => {
    setIsRedirecting(true)
    try {
      const created = await create.mutateAsync({ enabled: false })
      if (!created?.id) {
        setIsRedirecting(false)
        return
      }
      // REQUIRED, and `refetchType: 'none'` is the deliberate part. Without any
      // invalidate the list keeps serving its cached page: the global
      // `staleTime` is 30s and nothing here marks the query stale, so coming
      // back inside that window remounts on fresh data and never refetches —
      // and sitting on the list afterwards never fixes it either, because
      // staleness alone is not a refetch trigger (no mount, focus, or
      // reconnect, and this query has no interval). Marking it invalidated
      // makes the next mount refetch regardless of `staleTime`. `'none'`
      // suppresses the immediate refetch of the list we are about to leave —
      // same reasoning as `createAgent`'s skipped pre-redirect invalidate.
      await utils.workflow.list.invalidate(undefined, { refetchType: 'none' })
      posthog?.capture('workflow_created', { workflow_id: created.id })
      router.push(`/app/workflows/${created.id}`)
      // `isRedirecting` stays true on purpose: the builder route replacing this
      // tree is what clears it. Resetting here flashes the trigger back to idle
      // while the next page bootstraps.
    } catch {
      // `onError` already surfaced the toast.
      setIsRedirecting(false)
    }
  }, [create, posthog, router, utils])

  return { createWorkflow, isCreating: create.isPending || isRedirecting }
}
