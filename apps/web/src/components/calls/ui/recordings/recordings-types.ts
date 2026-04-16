// apps/web/src/components/calls/ui/recordings/recordings-types.ts

import type { BotStatus } from '@auxx/lib/recording/client'
import type { RouterOutputs } from '~/trpc/react'

export type Recording = RouterOutputs['recording']['list']['items'][number]

export interface RecordingsFilter {
  status: BotStatus | 'all'
  startDate?: Date
  endDate?: Date
}
