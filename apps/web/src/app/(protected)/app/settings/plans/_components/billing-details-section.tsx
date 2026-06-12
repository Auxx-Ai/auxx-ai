// app/(protected)/app/settings/plans/_components/billing-details-section.tsx
'use client'

import { Skeleton } from '@auxx/ui/components/skeleton'
import { Wallet } from 'lucide-react'
import { Suspense } from 'react'
import { SettingsSection } from '~/components/global/settings-page'
import { BillingAddressCard } from '~/components/subscriptions/billing-address-card'
import { PaymentMethodsCard } from '~/components/subscriptions/payment-methods-card'
import { api } from '~/trpc/react'

/**
 * Client wrapper for the Billing Details block. Hidden for providers that don't manage
 * payment methods in-app (Shopify) — the card on file lives in Shopify Admin, so the
 * section header would otherwise render with no cards beneath it.
 */
export function BillingDetailsSection() {
  const { data: subscription } = api.billing.getCurrentSubscription.useQuery()

  // Gate on the same capability the cards use; hide while cache is cold to avoid a flash.
  if (subscription && !subscription.capabilities?.managedPaymentMethods) return null

  return (
    <div id='billing-details' className='@container'>
      <SettingsSection
        className='space-y-3'
        icon={Wallet}
        title='Billing Details'
        description='Manage your payment methods and billing information'>
        <div className='grid grid-cols-1 @lg:grid-cols-2 gap-6'>
          <Suspense fallback={<BillingCardSkeleton />}>
            <BillingAddressCard />
          </Suspense>
          <Suspense fallback={<BillingCardSkeleton />}>
            <PaymentMethodsCard />
          </Suspense>
        </div>
      </SettingsSection>
    </div>
  )
}

function BillingCardSkeleton() {
  return (
    <div className='rounded-2xl border p-6 space-y-4'>
      <div className='flex items-center justify-between'>
        <div className='space-y-2'>
          <Skeleton className='h-5 w-24' />
          <Skeleton className='h-4 w-48' />
        </div>
        <Skeleton className='size-8 rounded' />
      </div>
      <div className='space-y-3'>
        {[1, 2, 3].map((i) => (
          <div key={i} className='grid grid-cols-[100px_1fr] gap-4'>
            <Skeleton className='h-4 w-20' />
            <Skeleton className='h-4 w-full' />
          </div>
        ))}
      </div>
    </div>
  )
}
