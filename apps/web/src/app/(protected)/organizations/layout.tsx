// apps/web/src/app/(protected)/organizations/layout.tsx

import type { ReactNode } from 'react'
import { SimpleLayout } from '~/components/layouts/simple-layout'

export default function OrganizationsLayout({ children }: { children: ReactNode }) {
  return (
    <SimpleLayout title='Organizations' showBackToDashboard={false}>
      {children}
    </SimpleLayout>
  )
}
