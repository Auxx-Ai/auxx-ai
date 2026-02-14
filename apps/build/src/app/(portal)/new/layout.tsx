import type { ReactNode } from 'react'
import { SimpleLayout } from '~/components/layouts/simple-layout'

export default function NewLayout({ children }: { children: ReactNode }) {
  return <SimpleLayout title='Subscription'>{children}</SimpleLayout>
}
