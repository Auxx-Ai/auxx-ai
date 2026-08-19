// apps/web/src/components/dispatch/hooks/use-invalidate-workers.ts
'use client'

import { api } from '~/trpc/react'

/**
 * Invalidate every cached read of the worker roster after a worker mutation.
 *
 * `dispatch.listWorkers` is not the only consumer: the calendar board builds its columns from
 * `dispatch.getBoard`'s `workers` array and the map planner from `dispatch.getRoutePlannerBoard`'s,
 * both cached at `ORG_STATIC_STALE_TIME`. Invalidating only `listWorkers` leaves a worker added
 * from the setup wizard or the worker dialog missing from the board until a full page reload.
 */
export function useInvalidateWorkers() {
  const utils = api.useUtils()
  return () => {
    void utils.dispatch.listWorkers.invalidate()
    void utils.dispatch.getBoard.invalidate()
    void utils.dispatch.getRoutePlannerBoard.invalidate()
  }
}
