// apps/web/src/components/threads/hooks/use-ticket-threads.ts

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { useMemo } from 'react'
import { useThreadList } from './use-thread-list'

/**
 * Hook to get threads linked to a specific ticket.
 * Builds a condition filter on the `ticket` field and delegates to useThreadList.
 */
export function useTicketThreads(ticketId: string | undefined) {
  const filter: ConditionGroup[] = useMemo(() => {
    if (!ticketId) return []
    return [
      {
        id: 'ticket-filter',
        logicalOperator: 'AND' as const,
        conditions: [
          {
            id: 'ticket',
            fieldId: 'ticket',
            operator: 'is',
            value: ticketId,
          },
        ],
      },
    ]
  }, [ticketId])

  const result = useThreadList({
    filter,
    sort: { field: 'lastMessageAt', direction: 'desc' },
  })

  return {
    threads: result.threads,
    threadIds: result.threadIds,
    isLoading: result.isLoading,
    total: result.total,
    refresh: result.refresh,
  }
}
