// apps/web/src/app/admin/users/page.tsx
'use client'

import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { UsersTable } from './_components/users-table'

/**
 * Users list page for admin
 */
export default function UsersPage() {
  return (
    <MainPage>
      <MainPageHeader>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Admin' href='/admin' />
          <MainPageBreadcrumbItem title='Users' href='/admin/users' last />
        </MainPageBreadcrumb>
      </MainPageHeader>
      <MainPageContent>
        <UsersTable />
      </MainPageContent>
    </MainPage>
  )
}
