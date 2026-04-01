// apps/web/src/hooks/use-quick-actions.ts

'use client'

import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '~/lib/extensions/use-app-store'
import {
  type SerializedQuickAction,
  WorkflowBlockLoader,
} from '~/lib/workflow/workflow-block-loader'
import { useExtensionsContext } from '~/providers/extensions/extensions-context'

/**
 * Hook to load available quick actions from installed apps.
 * Returns serialized quick actions with defaults pre-filled from context.
 */
export function useQuickActions(threadId?: string, ticketId?: string) {
  const appStore = useAppStore()
  const { appInstallations } = useExtensionsContext()
  const loaderRef = useRef<WorkflowBlockLoader | null>(null)
  const [actions, setActions] = useState<SerializedQuickAction[]>([])
  const [isLoading, setIsLoading] = useState(false)

  if (!loaderRef.current) {
    loaderRef.current = new WorkflowBlockLoader(appStore)
  }

  useEffect(() => {
    if (!appInstallations.length) return

    const loader = loaderRef.current!
    setIsLoading(true)

    const context = {
      threadId,
      ticket: undefined,
      participants: [],
      entities: [],
    }

    Promise.allSettled(
      appInstallations.map((inst) =>
        loader.loadAppQuickActions(inst.app.id, inst.installationId, context)
      )
    ).then(() => {
      setActions(loader.getAllQuickActions())
      setIsLoading(false)
    })
  }, [appInstallations, threadId, ticketId])

  return { actions, isLoading }
}
