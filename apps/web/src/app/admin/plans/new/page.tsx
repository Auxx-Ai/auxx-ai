// apps/web/src/app/admin/plans/new/page.tsx
/**
 * Create new plan page
 */
'use client'

import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { ArrowLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { PlanForm } from '../_components/plan-form'

/**
 * Create new plan page
 */
export default function NewPlanPage() {
  const router = useRouter()

  return (
    <MainPage>
      <MainPageHeader>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Admin' href='/admin' />
          <MainPageBreadcrumbItem title='Plans' href='/admin/plans' />
          <MainPageBreadcrumbItem title='New Plan' href='/admin/plans/new' last />
        </MainPageBreadcrumb>
      </MainPageHeader>
      <MainPageContent>
        <Card className='border-none rounded-none shadow-none'>
          <CardHeader>
            <CardTitle>Create New Plan</CardTitle>
            <CardDescription>Add a new billing plan to the system</CardDescription>
          </CardHeader>
          <CardContent>
            <PlanForm />
          </CardContent>
        </Card>
      </MainPageContent>
    </MainPage>
  )
}
