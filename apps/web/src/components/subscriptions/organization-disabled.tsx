// apps/web/src/components/subscriptions/organization-disabled.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Ban } from 'lucide-react'
import Link from 'next/link'

/** Props for OrganizationDisabled component */
interface OrganizationDisabledProps {
  /** Optional organization name for personalization */
  organizationName?: string | null
  /** Admin-supplied reason for the suspension */
  disabledReason?: string | null
  /** Number of other organizations the user has access to */
  otherOrganizationsCount?: number
}

/**
 * Shown when an organization has been suspended by a super admin
 * (`Organization.disabledAt`). Distinct from `SubscriptionEnded` — there is no
 * self-service path out of a suspension, so this offers support, not checkout.
 */
export function OrganizationDisabled({
  organizationName,
  disabledReason,
  otherOrganizationsCount = 0,
}: OrganizationDisabledProps) {
  return (
    <div className='flex items-center justify-center flex-1 min-h-0 h-full'>
      <div className='flex w-full max-w-sm flex-col items-center space-y-5 px-6 mx-auto'>
        <Card
          variant='translucent'
          className='w-full max-w-md shadow-md shadow-black/20 border-transparent'>
          <CardHeader className='text-center'>
            <div className='mx-auto mb-5 size-14 border flex items-center justify-center rounded-2xl bg-muted text-bad-500'>
              <Ban className='size-8' />
            </div>
            <CardTitle>
              {organizationName
                ? `${organizationName} is suspended`
                : 'This workspace is suspended'}
            </CardTitle>
            <CardDescription>
              Access has been suspended by Auxx. Contact support to resolve this.
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-3'>
            {disabledReason && (
              <div className='rounded-lg border bg-muted/50 p-3 text-sm'>
                <div className='font-medium mb-1'>Reason</div>
                <div className='text-muted-foreground'>{disabledReason}</div>
              </div>
            )}
            <Button asChild className='w-full'>
              <a href='mailto:support@auxx.ai' target='_blank' rel='noopener noreferrer'>
                Contact support
              </a>
            </Button>
            {otherOrganizationsCount > 0 && (
              <Button asChild variant='translucent' className='w-full'>
                <Link href='/organizations'>Switch workspace</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
