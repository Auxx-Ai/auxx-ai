// app/(protected)/app/settings/plans/page.tsx

import { isSelfHosted } from '@auxx/deployment'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Receipt } from 'lucide-react'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { CapabilityPageGuard } from '~/components/global/capability-page-guard'
import SettingsPage, { SettingsSection } from '~/components/global/settings-page'
import {
  BillingCycleAlert,
  BillingCycleAlertSkeleton,
} from '~/components/subscriptions/billing-cycle-alert'
import { CancelSubscriptionDialog } from '~/components/subscriptions/cancel-subscription-dialog'
import { InvoiceList } from '~/components/subscriptions/invoice-list'
import { PlanChangeCard } from '~/components/subscriptions/plan-change-card'
import { BillingDetailsSection } from './_components/billing-details-section'
import { DemoBillingCycleGuard } from './_components/demo-billing-cycle-guard'
import { PlanViewTracker } from './_components/plan-view-tracker'
import { ShopifyAdminBillingBannerWrapper } from './_components/shopify-admin-billing-banner-wrapper'
import { UpgradeConfetti } from './_components/upgrade-confetti'

export default function PlansPage() {
  if (isSelfHosted()) redirect('/app/settings')
  return (
    <SettingsPage
      title='Billing'
      description='Manage your subscription, plan, and payment details'
      breadcrumbs={[{ title: 'Settings', href: '/app/settings' }, { title: 'Plans' }]}>
      <div className='p-3 sm:p-6 space-y-6 sm:space-y-10'>
        <CapabilityPageGuard permissionKey='billing.view' />
        <PlanViewTracker />
        <UpgradeConfetti />
        <DemoBillingCycleGuard>
          <Suspense fallback={<BillingCycleAlertSkeleton />}>
            <BillingCycleAlert />
          </Suspense>
        </DemoBillingCycleGuard>

        <div id='plans' className=''>
          <Suspense fallback={<PlanChangeCardSkeleton />}>
            <PlanChangeCard />
          </Suspense>
        </div>

        <ShopifyAdminBillingBannerWrapper />

        <BillingDetailsSection />

        <SettingsSection
          className='space-y-3'
          icon={<Receipt className='size-4' />}
          title='History'
          description='View and track your past invoices'>
          <div className='rounded-2xl border'>
            <Suspense fallback={<InvoiceListSkeleton />}>
              <InvoiceList />
            </Suspense>
          </div>
        </SettingsSection>
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
    <div className='p-2 sm:p-6'>
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
