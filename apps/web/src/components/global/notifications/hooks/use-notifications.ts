// apps/web/src/components/global/notifications/hooks/use-notifications.ts
'use client'

import type { NotificationType } from '@auxx/database/types'
import { useDebounce } from '~/hooks/use-debounced-value'
import { api } from '~/trpc/react'

export function useNotifications(input: {
  open: boolean
  includeRead: boolean
  search: string
  types: NotificationType[]
}) {
  const debouncedSearch = useDebounce(input.search, 250)
  const query = api.notification.getNotifications.useInfiniteQuery(
    {
      includeRead: input.includeRead,
      search: debouncedSearch || undefined,
      types: input.types.length ? input.types : undefined,
      limit: 25,
    },
    {
      enabled: input.open,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      refetchOnWindowFocus: false,
    }
  )

  return {
    ...query,
    notifications: query.data?.pages.flatMap((page) => page.notifications) ?? [],
    debouncedSearch,
  }
}
