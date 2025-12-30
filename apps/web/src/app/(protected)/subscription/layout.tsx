// apps/web/src/app/(protected)/subscription/layout.tsx
import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { SimpleLayout } from '~/components/layouts/simple-layout'
import { type ReactNode } from 'react'

export default function SubscriptionLayout({ children }: { children: ReactNode }) {
  return (
    <SimpleLayout title="Subscription">
      <TooltipProvider>{children}</TooltipProvider>
    </SimpleLayout>
  )
}
