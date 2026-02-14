// apps/web/src/app/(protected)/subscription/layout.tsx
import { TooltipProvider } from '@auxx/ui/components/tooltip'
import type { ReactNode } from 'react'
import { SimpleLayout } from '~/components/layouts/simple-layout'

export default function SubscriptionLayout({ children }: { children: ReactNode }) {
  return (
    <SimpleLayout title='Subscription'>
      <TooltipProvider>{children}</TooltipProvider>
    </SimpleLayout>
  )
}
