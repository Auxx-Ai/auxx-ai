// apps/web/src/hooks/use-quick-actions.ts

'use client'

import { useMemo } from 'react'
import type { SerializedQuickAction } from '~/lib/workflow/workflow-block-loader'
import {
  type AppInstallation,
  useExtensionsContext,
} from '~/providers/extensions/extensions-context'

/**
 * Hook to load available quick actions from installed apps.
 *
 * Reads directly from the deployment catalog's `actions` projection (exposed
 * via `useExtensionsContext` → `apps.listInstalled` → cached envelope). No
 * iframe boot — the picker renders synchronously from the trpc cache.
 *
 * See plans/kopilot/agents/triggers/app-surface-implementation-plan.md §10.2.
 */
export function useQuickActions(_threadId?: string, _ticketId?: string) {
  const { appInstallations, isLoading } = useExtensionsContext()

  const actions = useMemo<SerializedQuickAction[]>(
    () => appInstallations.flatMap(installationToActions),
    [appInstallations]
  )

  return { actions, isLoading }
}

function installationToActions(installation: AppInstallation): SerializedQuickAction[] {
  const actions = installation.actions ?? []
  if (actions.length === 0) return []

  // Build a tool-id → agent tool lookup for input schemas. Action-only tools
  // aren't in `agentTools`, so their inputs render as an empty form until the
  // envelope is extended with a tools-by-id projection.
  const toolsById = new Map((installation.agentTools ?? []).map((t) => [t.id, t]))

  return actions.map((action) => {
    const tool = toolsById.get(action.toolId)
    return {
      id: action.toolId,
      label: action.label,
      description: action.description,
      icon: action.iconKey ?? undefined,
      color: action.color,
      inputs: (tool?.inputsJsonSchema as Record<string, any>) ?? {},
      outputs: (tool?.outputsJsonSchema as Record<string, any>) ?? {},
      defaults: {},
      appId: installation.app.id,
      installationId: installation.installationId,
    }
  })
}
