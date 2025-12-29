// apps/web/src/app/(protected)/subscription/layout.tsx
import { SimpleLayout } from '~/components/layouts/simple-layout'
import { type ReactNode } from 'react'

export default function SubscriptionLayout({ children }: { children: ReactNode }) {
  return <SimpleLayout title="Subscription">{children}</SimpleLayout>
}
