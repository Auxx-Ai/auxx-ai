// apps/web/src/components/dispatch/ui/shared/assignee-row.tsx

'use client'

import { getActorRawId, toActorId } from '@auxx/types/actor'
import type { SeriesScope } from '@auxx/ui/components/event-calendar'
import { EventPeopleSection, useSeriesScope } from '@auxx/ui/components/event-calendar'
import { ActorPickerContent } from '~/components/pickers/actor-picker/actor-picker-content'
import { useActors } from '~/components/resources/hooks/use-actor'

export interface AssigneeRowProps {
  /** The assigned `DispatchWorker.id` (individual or team), or `null` when unassigned. */
  value: string | null
  onChange: (workerId: string | null, scope: SeriesScope) => void
  disabled?: boolean
}

/**
 * Shared assignee row (decision #11) — an `EventPeopleSection` whose nested picker popover is an
 * `ActorPickerContent` scoped to the `worker` actor kind (45-teams.md §5A), so individuals and
 * teams list together and selection yields a `DispatchWorker.id`. Selecting gates the commit
 * through `useSeriesScope()` so series membership is handled identically to every other committing
 * section in the base. Used by both the board visit popover and the converged schedule popover.
 */
export function AssigneeRow({ value, onChange, disabled }: AssigneeRowProps) {
  const { gate } = useSeriesScope()
  const assigneeActorId = value ? toActorId('worker', value) : null
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
          target='worker'
          multi={false}
          onSelectSingle={(actorId) => {
            gate((scope) => onChange(getActorRawId(actorId), scope))
            close()
          }}
          placeholder='Search workers…'
        />
      )}
    />
  )
}
