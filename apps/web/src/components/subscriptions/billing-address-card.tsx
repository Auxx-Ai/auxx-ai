// app/(protected)/app/settings/plans/_components/billing-address-card.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { MapPin, Pencil } from 'lucide-react'
import { useState } from 'react'
import { api } from '~/trpc/react'
import { BillingAddressDialog } from './billing-address-dialog'

/** Card component displaying billing address with edit functionality */
export function BillingAddressCard() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const { data: billingDetails, isLoading } = api.billing.getBillingDetails.useQuery()

  /** Format address into single line string */
  const formatAddress = (address: any) => {
    if (!address) return 'No address on file'
    const parts = [
      address.line1,
      address.line2,
      address.city,
      address.state,
      address.postal_code,
      address.country,
    ].filter(Boolean)
    return parts.join(', ')
  }

  return (
    <>
      <div className='rounded-2xl border p-3 space-y-4'>
        <div className='flex items-center justify-between'>
          <div className='space-y-1'>
            <div className='flex items-center gap-2 leading-none tracking-tight font-semibold text-foreground'>
              <MapPin className='size-4' /> Address
            </div>
            <p className='text-sm text-muted-foreground'>Update your billing address</p>
          </div>
          <Button
            variant='outline'
            size='icon-sm'
            className='-mt-7 -mr-2 rounded-full'
            onClick={() => setDialogOpen(true)}
            disabled={isLoading}>
            <Pencil />
          </Button>
        </div>

        {isLoading ? (
          <div className='space-y-3'>
            <div className='grid grid-cols-[100px_1fr] gap-4'>
              <Skeleton className='h-4 w-20' />
              <Skeleton className='h-4 w-full' />
            </div>
            <div className='grid grid-cols-[100px_1fr] gap-4'>
              <Skeleton className='h-4 w-20' />
              <Skeleton className='h-4 w-full' />
            </div>
            <div className='grid grid-cols-[100px_1fr] gap-4'>
              <Skeleton className='h-4 w-20' />
              <Skeleton className='h-4 w-full' />
            </div>
          </div>
        ) : (
          <div className='space-y-3'>
            <div className='grid grid-cols-[100px_1fr] gap-4 text-sm'>
              <span className='text-muted-foreground'>Email</span>
              <span title={billingDetails?.email || 'Not set'} className='font-medium truncate'>
                {billingDetails?.email || 'Not set'}
              </span>
            </div>
            <div className='grid grid-cols-[100px_1fr] gap-4 text-sm'>
              <span className='text-muted-foreground'>Company</span>
              <span
                title={billingDetails?.companyName || 'Not set'}
                className='font-medium truncate'>
                {billingDetails?.companyName || 'Not set'}
              </span>
            </div>
            <div className='grid grid-cols-[100px_1fr] gap-4 text-sm'>
              <span className='text-muted-foreground'>Address</span>
              <span className='font-medium'>{formatAddress(billingDetails?.address)}</span>
            </div>
          </div>
        )}
      </div>

      <BillingAddressDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        billingDetails={billingDetails}
      />
    </>
  )
}
