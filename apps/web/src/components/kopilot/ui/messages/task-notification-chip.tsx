// apps/web/src/components/kopilot/ui/messages/task-notification-chip.tsx

'use client'

import { BellRing } from 'lucide-react'
import type { KopilotMessage } from '../../stores/kopilot-store'

/** Human label per task kind; falls back to a generic line for new kinds. */
const KIND_LABELS: Record<string, string> = {
  'eval-suite': 'Simulation suite finished',
}

/**
 * Muted, centered chip for task-notification messages — these are
 * machine-injected continuations, not something the user said, so they must
 * not render as a user bubble (and carry no edit/retry affordances).
 */
export function TaskNotificationChip({ message }: { message: KopilotMessage }) {
  const kind = message.metadata?.kind ?? ''
  const label = KIND_LABELS[kind] ?? 'Background task finished'

  return (
    <div className='flex justify-center py-1'>
      <div className='inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-3 py-1 text-xs text-muted-foreground'>
        <BellRing className='size-3' />
        <span>{label}</span>
      </div>
    </div>
  )
}
