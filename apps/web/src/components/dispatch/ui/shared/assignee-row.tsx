// apps/web/src/components/dispatch/ui/shared/assignee-row.tsx

'use client'

import { getActorRawId, toActorId } from '@auxx/types/actor'
import type { SeriesScope } from '@auxx/ui/components/event-calendar'
import { EventPeopleSection, useSeriesScope } from '@auxx/ui/components/event-calendar'
import { ActorPickerContent } from '~/components/pickers/actor-picker/actor-picker-content'
import { useActors } from '~/components/resources/hooks/use-actor'
import { useWorkerActorExcludes } from './use-worker-actor-excludes'

export interface AssigneeRowProps {
  value: string | null
  onChange: (userId: string | null, scope: SeriesScope) => void
  disabled?: boolean
}

/**
 * Shared assignee row (decision #11) — an `EventPeopleSection` whose nested picker popover is a
 * worker-filtered `ActorPickerContent` (`useWorkerActorExcludes`). Selecting a worker gates the
 * commit through `useSeriesScope()` so series membership is handled identically to every other
 * committing section in the base. Used by both the board visit popover and the converged
 * schedule popover (schedule-popover.tsx:242-244, 357-368, 417-431).
 */
export function AssigneeRow({ value, onChange, disabled }: AssigneeRowProps) {
  const { gate } = useSeriesScope()
  const excludeIds = useWorkerActorExcludes()
  const assigneeActorId = value ? toActorId('user', value) : null
  const hydratedAssignee = useActors(assigneeActorId ? [assigneeActorId] : [])
  const assigneeActor = assigneeActorId ? hydratedAssignee.get(assigneeActorId) : undefined

  return (
    <EventPeopleSection
      label='Assignee'
      person={
        assigneeActor ? { name: assigneeActor.name, avatarUrl: assigneeActor.avatarUrl } : null
      }
      disabled={disabled}
      renderPicker={(close) => (
        <ActorPickerContent
          value={assigneeActorId ? [assigneeActorId] : []}
          onChange={() => {}}
          target='user'
          multi={false}
          excludeIds={excludeIds}
          onSelectSingle={(actorId) => {
            gate((scope) => onChange(getActorRawId(actorId), scope))
            close()
          }}
          placeholder='Search workers...'
        />
      )}
    />
  )
}
