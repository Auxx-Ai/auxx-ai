// apps/web/src/components/mail-permissions/ui/lens-badge.tsx
'use client'

import { LENS_LABELS, type Lens } from '@auxx/lib/permissions/visibility/client'
import { Badge } from '@auxx/ui/components/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@auxx/ui/components/tooltip'
import { Lock } from 'lucide-react'

/**
 * Small chip showing the viewer's own level on a thread ("Subject only" /
 * "Activity only"). Rendered only below `full` — full access shows nothing.
 */
export function LensBadge({ lens, inboxName }: { lens: Lens; inboxName?: string | null }) {
  if (lens === 'full' || lens === 'none') return null

  const scope =
    lens === 'subject'
      ? 'You can see who, when, and subject lines in this conversation — not its content.'
      : 'You can see activity in this conversation — not subjects or content.'
  const hint = inboxName ? ` Ask a manager of ${inboxName} for access.` : ''

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant='outline' className='gap-1 text-muted-foreground'>
          <Lock className='size-3' />
          {LENS_LABELS[lens].label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        <div className='max-w-xs'>
          {scope}
          {hint}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
