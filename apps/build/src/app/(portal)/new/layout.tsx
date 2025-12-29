import { SimpleLayout } from '~/components/layouts/simple-layout'
import { type ReactNode } from 'react'

export default function NewLayout({ children }: { children: ReactNode }) {
  return <SimpleLayout title="Subscription">{children}</SimpleLayout>
}
