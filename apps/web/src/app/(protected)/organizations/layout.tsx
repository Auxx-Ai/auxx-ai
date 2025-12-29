// apps/web/src/app/(protected)/organizations/layout.tsx
import { SimpleLayout } from '~/components/layouts/simple-layout'
import { ReactNode } from 'react'

export default function OrganizationsLayout({ children }: { children: ReactNode }) {
  return <SimpleLayout title="Organizations" showBackToDashboard={false}>{children}</SimpleLayout>
}
