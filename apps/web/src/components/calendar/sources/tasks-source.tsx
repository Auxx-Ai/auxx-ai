// apps/web/src/components/calendar/sources/tasks-source.tsx
//
// Calendar source for the signed-in user's assigned tasks by deadline (`task.list`) — plan
// plans/calendar/02-schedule-calendar-view.md §3.5 (Phase 3). Tasks are the only calendar
// surface for the native `Task` table — there is no standalone reminder/event table yet
// (decision C′) and the records calendar (plan 03) can't show them (`Task` isn't an
// EntityDefinition).

'use client'

import { useMemo } from 'react'
import { useSession } from '~/auth/auth-client'
import type { CalendarSource, SourcedEvent } from '~/components/calendar/core/types'
import { api, type RouterOutputs } from '~/trpc/react'

/** Amber-500 — the tasks source's default toggle-dot/chip color (decision D: color is per-surface). */
const TASKS_COLOR = '#f59e0b'

type TaskRow = RouterOutputs['task']['list']['tasks'][number]

/** A `task.list` row mapped onto the shared event shape, carrying the full row for the click target. */
export interface TaskEvent extends SourcedEvent {
  task: TaskRow
}

/**
 * Calendar source for the signed-in user's assigned tasks. Descriptor buckets it into the
 * `'kinds'` sidebar group alongside `visits`/`meetings`; `useEvents` reads the range-windowed
 * `task.list` query (assigned to me, incomplete, deadline within range) and is skipped entirely
 * via `enabled` when the source is hidden or the session hasn't resolved a user id yet.
 *
 * Known cap: `task.list` is cursor-paginated — v1 reads one page (`limit: 100`) per range
 * window, which is fine for a single person's assigned-task counts; revisit with pagination if
 * that ever proves wrong.
 */
export const tasksSource: CalendarSource<TaskEvent> = {
  descriptor: {
    id: 'tasks',
    label: 'Tasks',
    group: 'kinds',
    color: TASKS_COLOR,
  },

  useEvents: (range, enabled) => {
    const { data: session } = useSession()
    const userId = session?.user?.id

    const query = api.task.list.useQuery(
      {
        assigneeIds: [userId!],
        deadlineFrom: range.from,
        deadlineTo: range.to,
        includeCompleted: false,
        limit: 100,
      },
      { enabled: enabled && !!userId, placeholderData: (prev) => prev }
    )

    const events = useMemo<TaskEvent[]>(
      () =>
        (query.data?.tasks ?? []).flatMap((task) => {
          // Defensive — the deadline filter should exclude these, but a null deadline has
          // nowhere to render on the grid.
          if (!task.deadline) return []
          return [
            {
              id: task.id,
              title: task.title,
              start: task.deadline,
              end: task.deadline,
              allDay: true,
              color: TASKS_COLOR,
              sourceId: 'tasks',
              task,
            },
          ]
        }),
      [query.data]
    )

    return { events, isLoading: query.isLoading }
  },

  renderEvent: (event) => (
    <div className='flex h-full w-full min-w-0 items-center gap-1 overflow-hidden px-1'>
      <span className='min-w-0 flex-1 truncate text-[10px] font-semibold sm:text-xs'>
        {event.title}
      </span>
    </div>
  ),
}
