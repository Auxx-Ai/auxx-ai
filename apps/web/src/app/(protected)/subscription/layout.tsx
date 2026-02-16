// apps/web/src/app/(protected)/subscription/layout.tsx
import { isSelfHosted } from '@auxx/deployment'
import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { SimpleLayout } from '~/components/layouts/simple-layout'

export default function SubscriptionLayout({ children }: { children: ReactNode }) {
  // All subscription routes are SaaS-only
  if (isSelfHosted()) redirect('/app')

  return (
    <SimpleLayout title='Subscription'>
      <TooltipProvider>{children}</TooltipProvider>
    </SimpleLayout>
  )
}
