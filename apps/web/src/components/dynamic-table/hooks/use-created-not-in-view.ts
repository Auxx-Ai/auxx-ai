// apps/web/src/components/dynamic-table/hooks/use-created-not-in-view.ts
'use client'

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '~/trpc/react'

/** Ceiling on tracked ids — matches the procedure's input cap. */
const MAX_TRACKED = 50

interface UseCreatedNotInViewParams {
  entityDefinitionId: string | undefined
  /** The merged groups this view queries with — baseline + the user's filters. */
  filters: ConditionGroup[] | undefined
  /** The free-text axis, which can exclude a record just as filters can. */
  search: string | undefined
  /**
   * The list's current ids. Not read for membership — a record absent from the
   * loaded pages may simply be on page 40 — but used as the *signal* that the
   * list re-answered, so this hook re-asks at the same moments (a refetch, a
   * realtime invalidation, a record rule landing).
   */
  listIds: string[]
}

export interface CreatedNotInView {
  /** How many records created here are currently absent from this view. */
  notShownCount: number
  /** Record an id created in this view. */
  noteCreated: (instanceId: string) => void
  /** Stop reporting — until something is created here again. */
  dismiss: () => void
}

/**
 * "Records you created here that this view isn't showing."
 *
 * The answer is **derived, never latched**. Two races make a stored verdict a
 * lie waiting to happen: the client's copy of a fresh record predates every
 * server-side default and hook, and record rules run *after* the create
 * response, in the worker — either can move a record into or out of the view
 * seconds later. So this holds only the set of ids created here, and re-asks the
 * server (with the same compiled predicate the list uses) whenever the list
 * itself re-answers. A rule that pulls a record in makes the notice disappear on
 * its own; nothing has to expire or reconcile.
 *
 * Biased hard toward silence: an unanswered question renders nothing, which is
 * the behaviour that existed before this. A *false* "not shown" — on a row
 * sitting visibly in the list — is the only failure mode worse than saying
 * nothing at all.
 */
export function useCreatedNotInView({
  entityDefinitionId,
  filters,
  search,
  listIds,
}: UseCreatedNotInViewParams): CreatedNotInView {
  const [createdIds, setCreatedIds] = useState<string[]>([])
  const [dismissed, setDismissed] = useState(false)

  // Which question this view is asking. When it changes the tracked set is
  // meaningless — the member has moved to a different list, and an answer about
  // the old one would be a stale claim with no one to correct it.
  const scopeKey = useMemo(
    () => JSON.stringify([entityDefinitionId, filters ?? null, search ?? null]),
    [entityDefinitionId, filters, search]
  )

  useEffect(() => {
    setCreatedIds([])
    setDismissed(false)
  }, [scopeKey])

  const noteCreated = useCallback((instanceId: string) => {
    setDismissed(false)
    setCreatedIds((prev) =>
      prev.includes(instanceId) ? prev : [...prev, instanceId].slice(-MAX_TRACKED)
    )
  }, [])

  const dismiss = useCallback(() => setDismissed(true), [])

  const { data, refetch } = api.record.matchesFilters.useQuery(
    {
      entityDefinitionId: entityDefinitionId ?? '',
      filters,
      search,
      recordIds: createdIds,
    },
    { enabled: !!entityDefinitionId && createdIds.length > 0, staleTime: 0 }
  )

  // Re-ask whenever the list re-answers. `refresh()` and the `records:invalidated`
  // realtime frames both land here as a changed id set, which is the only signal
  // that covers a record rule firing after the create response.
  const listSignature = useMemo(() => listIds.join(','), [listIds])
  useEffect(() => {
    if (createdIds.length > 0) void refetch()
  }, [listSignature, createdIds.length, refetch])

  if (dismissed || createdIds.length === 0 || !data) {
    return { notShownCount: 0, noteCreated, dismiss }
  }

  const matched = new Set(data.matchedIds)
  return {
    notShownCount: createdIds.filter((id) => !matched.has(id)).length,
    noteCreated,
    dismiss,
  }
}
