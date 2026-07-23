// apps/web/src/components/permissions/ui/no-access.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Lock } from 'lucide-react'
import Link from 'next/link'
import { EmptyState } from '~/components/global/empty-state'

interface NoAccessProps {
  /** Area name for the message, e.g. "Tickets". Optional. */
  area?: string
  /** Where the "back" button points. Defaults to the app home. */
  backHref?: string
  backLabel?: string
}

/**
 * Friendly "you don't have access to this area" surface for direct-URL hits
 * where `useAccess().deniedBy(key) === 'permission'` — a field seat deep-linking
 * a gated area (e.g. `/app/tickets`) lands here instead of crashing or
 * redirect-looping. This is the permission-denied surface (nothing to buy);
 * plan-denied areas should render `UpgradeBanner` instead (§7.3).
 */
export function NoAccess({ area, backHref = '/app', backLabel = 'Back to home' }: NoAccessProps) {
  return (
    <div className='flex h-full min-h-[60vh] w-full flex-1'>
      <EmptyState
        icon={Lock}
        title={area ? `You don't have access to ${area}` : "You don't have access to this area"}
        description="Your account doesn't include this area. Ask an organization admin if you think you should have access."
        button={
          <Button asChild variant='outline'>
            <Link href={backHref}>{backLabel}</Link>
          </Button>
        }
      />
    </div>
  )
}
