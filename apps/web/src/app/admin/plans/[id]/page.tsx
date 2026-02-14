// apps/web/src/app/admin/plans/[id]/page.tsx
/**
 * Plan edit page
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
import { Skeleton } from '@auxx/ui/components/skeleton'
import { ArrowLeft } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '~/trpc/react'
import { PlanForm } from '../_components/plan-form'

/**
 * Plan edit page
 */
export default function PlanEditPage() {
  const params = useParams()
  const router = useRouter()
  const planId = params.id as string

  const { data: plan, isLoading } = api.admin.plans.getById.useQuery(
    { id: planId },
    { enabled: !!planId }
  )

  return (
    <MainPage loading={isLoading}>
      <MainPageHeader>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Admin' href='/admin' />
          <MainPageBreadcrumbItem title='Plans' href='/admin/plans' />
          <MainPageBreadcrumbItem
            title={isLoading ? 'Loading...' : plan ? plan.name : 'Not Found'}
            href={`/admin/plans/${planId}`}
            last
          />
        </MainPageBreadcrumb>
      </MainPageHeader>
      <MainPageContent>
        <Card className='border-none rounded-none shadow-none'>
          <CardHeader>
            <CardTitle>
              {isLoading ? <Skeleton className='h-7 w-48' /> : `Edit ${plan?.name}`}
            </CardTitle>
            <CardDescription>Update plan details and pricing</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className='space-y-4'>
                <Skeleton className='h-10 w-full' />
                <Skeleton className='h-20 w-full' />
                <Skeleton className='h-10 w-full' />
              </div>
            ) : plan ? (
              <PlanForm plan={plan} />
            ) : (
              <div className='flex flex-col items-center justify-center py-12 gap-4'>
                <p className='text-center text-muted-foreground'>Plan not found</p>
                <Button variant='outline' onClick={() => router.push('/admin/plans')}>
                  <ArrowLeft />
                  Back to Plans
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </MainPageContent>
    </MainPage>
  )
}
