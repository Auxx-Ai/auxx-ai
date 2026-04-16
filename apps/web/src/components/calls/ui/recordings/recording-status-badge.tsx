// apps/web/src/components/calls/ui/recordings/recording-status-badge.tsx

import { type BotStatus, TERMINAL_STATUSES } from '@auxx/lib/recording/client'
import { Badge, type Variant } from '@auxx/ui/components/badge'

const STATUS_CONFIG: Record<BotStatus, { label: string; variant: Variant }> = {
  created: { label: 'Created', variant: 'outline' },
  joining: { label: 'Joining', variant: 'zinc' },
  waiting: { label: 'Waiting', variant: 'yellow' },
  admitted: { label: 'Admitted', variant: 'blue' },
  recording: { label: 'Recording', variant: 'red' },
  processing: { label: 'Processing', variant: 'blue' },
  completed: { label: 'Completed', variant: 'green' },
  failed: { label: 'Failed', variant: 'red' },
  kicked: { label: 'Kicked', variant: 'red' },
  denied: { label: 'Denied', variant: 'red' },
  timeout: { label: 'Timeout', variant: 'red' },
  cancelled: { label: 'Cancelled', variant: 'zinc' },
}

export function RecordingStatusBadge({ status }: { status: BotStatus }) {
  const config = STATUS_CONFIG[status] ?? { label: status, variant: 'outline' as const }
  const isActive = !TERMINAL_STATUSES.includes(status)

  return (
    <Badge variant={config.variant} className='text-xs'>
      {isActive && (
        <span className='mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-current' />
      )}
      {config.label}
    </Badge>
  )
}
