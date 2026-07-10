// apps/web/src/components/dispatch/ui/board/hooks/use-board-realtime.ts

'use client'

import { useCallback } from 'react'
import { useOrgChannel } from '~/realtime/hooks'
import { api } from '~/trpc/react'
import type { DateRange } from './use-board-data'

/**
 * Live board updates (07 §D.5, the `use-eval-cases-realtime.ts` recipe): any
 * `dispatch:visit-changed` broadcast for the org invalidates `dispatch.getBoard` for the
 * current range. The acting client's own writes are excluded server-side via the
 * `x-realtime-socket-id` header (attached globally by the tRPC client link), so this never
 * double-patches the tab that made the change — only other tabs/users refetch.
 */
export function useBoardRealtime(range: DateRange) {
  const utils = api.useUtils()

  const onEvent = useCallback(
    (event: string) => {
      if (event !== 'dispatch:visit-changed') return
      void utils.dispatch.getBoard.invalidate(range)
    },
    [range, utils]
  )

  useOrgChannel({ onEvent })
}
