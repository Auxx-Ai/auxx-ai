// app/(protected)/app/settings/plans/page.tsx

import { isSelfHosted } from '@auxx/deployment'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Receipt, Wallet } from 'lucide-react'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import SettingsPage from '~/components/global/settings-page'
import { BillingAddressCard } from '~/components/subscriptions/billing-address-card'
import {
  BillingCycleAlert,
  BillingCycleAlertSkeleton,
} from '~/components/subscriptions/billing-cycle-alert'
import { CancelSubscriptionDialog } from '~/components/subscriptions/cancel-subscription-dialog'
import { InvoiceList } from '~/components/subscriptions/invoice-list'
import { PaymentMethodsCard } from '~/components/subscriptions/payment-methods-card'
import { PlanChangeCard } from '~/components/subscriptions/plan-change-card'
import { UpgradeConfetti } from './_components/upgrade-confetti'

export default function PlansPage() {
  if (isSelfHosted()) redirect('/app/settings')
  return (
    <SettingsPage
      title='Billing'
      description='Manage your subscription, plan, and payment details'
      breadcrumbs={[{ title: 'Settings', href: '/app/settings' }, { title: 'Plans' }]}>
      <div className='p-6 space-y-10'>
        <UpgradeConfetti />
        <Suspense fallback={<BillingCycleAlertSkeleton />}>
          <BillingCycleAlert />
        </Suspense>

        <div id='plans' className=''>
          <Suspense fallback={<PlanChangeCardSkeleton />}>
            <PlanChangeCard />
          </Suspense>
        </div>

        <div id='billing-details' className='@container space-y-3'>
          <div className='space-y-1'>
            <div className='flex items-center gap-2 leading-none tracking-tight font-semibold text-foreground'>
              <Wallet className='size-4' /> Billing Details
            </div>
            <div className='text-sm text-muted-foreground mb-4'>
              Manage your payment methods and billing information
            </div>
          </div>
          <div className='grid grid-cols-1 @lg:grid-cols-2 gap-6'>
            <Suspense fallback={<BillingCardSkeleton />}>
              <BillingAddressCard />
            </Suspense>
            <Suspense fallback={<BillingCardSkeleton />}>
              <PaymentMethodsCard />
            </Suspense>
          </div>
        </div>

        <div className='space-y-3'>
          <div className='space-y-1'>
            <div className='flex items-center gap-2 leading-none tracking-tight font-semibold text-foreground'>
              <Receipt className='size-4' /> History
            </div>
            <div className='text-sm text-muted-foreground mb-4'>
              View and track your past invoices
            </div>
          </div>
          <div className='rounded-2xl border'>
            <Suspense fallback={<InvoiceListSkeleton />}>
              <InvoiceList />
            </Suspense>
          </div>
        </div>
        <div className='space-y-4'>
          <CancelSubscriptionDialog />
        </div>
      </div>
    </SettingsPage>
  )
}

function PlanChangeCardSkeleton() {
  return (
    <div className='space-y-4'>
      <div className='flex items-center gap-2'>
        <Skeleton className='h-4 w-4' />
        <Skeleton className='h-4 w-24' />
      </div>
      <div className='rounded-2xl border py-2 px-3'>
        <div className='flex items-center justify-between'>
          <div className='flex flex-row items-center gap-2'>
            <Skeleton className='size-8 rounded-lg' />
            <div className='flex flex-col gap-2'>
              <Skeleton className='h-4 w-32' />
              <Skeleton className='h-3 w-24' />
            </div>
          </div>
          <Skeleton className='h-9 w-28' />
        </div>
      </div>
    </div>
  )
}

function InvoiceListSkeleton() {
  return (
    <div className='p-6'>
      <div className='space-y-4'>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className='flex items-center justify-between py-2'>
            <div className='space-y-2'>
              <Skeleton className='h-4 w-32' />
              <Skeleton className='h-3 w-24' />
            </div>
            <Skeleton className='h-4 w-20' />
          </div>
        ))}
      </div>
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
