// apps/web/src/components/agents/ui/detail/triggers/trigger-label.tsx
'use client'

import { getTriggerLabel } from '@auxx/lib/agents/client'
import { useResource } from '~/components/resources/hooks/use-resource'
import type { RouterOutputs } from '~/trpc/react'

type Trigger = RouterOutputs['agentTrigger']['list'][number]

/**
 * Resolves the human label for an agent trigger row. For CRUD-event rows we
 * look up the resource client-side so custom entities render their label
 * (e.g. `On Vendor created`) rather than a raw cuid. All other kinds fall
 * back to the server-safe `getTriggerLabel`.
 */
export function TriggerLabel({ row }: { row: Trigger }) {
  const isCrudEvent = row.kind === 'event' && !!row.entityDefinitionId && !!row.triggerType
  const { resource } = useResource(isCrudEvent ? row.entityDefinitionId : undefined)

  if (isCrudEvent) {
    const base = resource?.label
      ? `On ${resource.label} ${row.triggerType}`
      : `On ${row.entityDefinitionId}:${row.triggerType}`
    return <span>{row.enabled ? base : `${base} (paused)`}</span>
  }

  return <span>{getTriggerLabel(row)}</span>
}
