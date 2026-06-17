// apps/web/src/components/agents/ui/detail/triggers/trigger-label.tsx
'use client'

import { getTriggerLabel } from '@auxx/lib/agents/client'
import { useAppsContext } from '~/components/apps/providers/apps-context'
import { useResource } from '~/components/resources/hooks/use-resource'
import type { RouterOutputs } from '~/trpc/react'

type Trigger = RouterOutputs['agentTrigger']['list'][number]

/**
 * Resolves the human label for an agent trigger row. CRUD-event rows look up
 * the resource client-side so custom entities render their label (e.g.
 * `On Vendor created`). App-kind rows resolve `triggerAppId` /
 * `triggerAppTriggerId` against `useAppsContext()` so we surface the
 * app's display title + the trigger's label rather than raw ids. All other
 * kinds fall back to the server-safe `getTriggerLabel`.
 */
export function TriggerLabel({ row }: { row: Trigger }) {
  const isCrudEvent = row.kind === 'event' && !!row.entityDefinitionId && !!row.triggerType
  const { resource } = useResource(isCrudEvent ? row.entityDefinitionId : undefined)
  const { appInstallations } = useAppsContext()

  if (isCrudEvent) {
    const base = resource?.label
      ? `On ${resource.label} ${row.triggerType}`
      : `On ${row.entityDefinitionId}:${row.triggerType}`
    return <span>{base}</span>
  }

  if (row.kind === 'app' && row.triggerAppId && row.triggerAppTriggerId) {
    const installation =
      appInstallations.find((i) => i.installationId === row.triggerInstallationId) ??
      appInstallations.find((i) => i.app.id === row.triggerAppId)
    const triggerProj = installation?.agentTriggers?.find(
      (t) => t.triggerId === row.triggerAppTriggerId
    )
    const appTitle = installation?.app.title ?? row.triggerAppId
    const triggerLabel = triggerProj?.label ?? row.triggerAppTriggerId
    return <span>{`${appTitle} · ${triggerLabel}`}</span>
  }

  return <span>{getTriggerLabel(row)}</span>
}
