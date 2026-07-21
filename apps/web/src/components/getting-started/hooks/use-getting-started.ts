// apps/web/src/components/getting-started/hooks/use-getting-started.ts
'use client'

import type { ChecklistId, GoalKey } from '@auxx/lib/getting-started/client'
import { useMemo } from 'react'
import { api } from '~/trpc/react'
import type { GettingStartedGoal } from '../client'

/**
 * Wraps the getting-started tRPC query and folds the server status into a
 * given display catalog. Returns the displayed goals, a completed-key set,
 * the done/total ratio, and the mutation handlers (each invalidates the
 * query). `checklistId` selects which checklist's state is read/written
 * (`main` or `dispatch`); `catalog` is the checklist's display catalog.
 */
export function useGettingStarted(checklistId: ChecklistId, catalog: GettingStartedGoal[]) {
  const utils = api.useUtils()
  const { data, isLoading } = api.gettingStarted.getStatus.useQuery(
    { checklist: checklistId },
    { staleTime: 60_000 }
  )

  const invalidate = () => utils.gettingStarted.getStatus.invalidate()

  const markGoalComplete = api.gettingStarted.markGoalComplete.useMutation({
    onSuccess: invalidate,
  })
  const completeAll = api.gettingStarted.completeAll.useMutation({ onSuccess: invalidate })
  const setDismissed = api.gettingStarted.setDismissed.useMutation({ onSuccess: invalidate })

  // The displayed list is the whole catalog for v1 (no role/feature gating yet).
  const goals = catalog
  const completed = useMemo(() => new Set<GoalKey>(data?.completedGoals ?? []), [data])

  const done = goals.filter((g) => completed.has(g.key)).length
  const total = goals.length

  return {
    isLoading,
    goals,
    completed,
    done,
    total,
    allComplete: total > 0 && done === total,
    dismissed: data?.dismissed ?? false,
    markGoalComplete: (key: GoalKey) => markGoalComplete.mutate({ checklist: checklistId, key }),
    completeAll: () =>
      completeAll.mutate({ checklist: checklistId, keys: goals.map((g) => g.key) }),
    dismiss: () => setDismissed.mutate({ checklist: checklistId, dismissed: true }),
  }
}
