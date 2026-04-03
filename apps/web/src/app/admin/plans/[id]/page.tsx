// apps/web/src/app/admin/plans/[id]/page.tsx
/**
 * Plan edit page — two-column layout with plan details on the left and feature limits on the right.
 */
'use client'

import type { FeatureDefinition } from '@auxx/lib/permissions/client'
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
import { toastError } from '@auxx/ui/components/toast'
import { ArrowLeft } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { FeatureLimitsCard } from '~/app/admin/_components/features'
import { api } from '~/trpc/react'
import { FeaturesListEditor } from '../_components/features-list-editor'
import { PlanDetailsCard } from '../_components/plan-details-card'
import type { PlanFormData } from '../_components/plan-form-types'

export default function PlanEditPage() {
  const params = useParams()
  const router = useRouter()
  const planId = params.id as string

  const { data: plan, isLoading } = api.admin.plans.getById.useQuery(
    { id: planId },
    { enabled: !!planId }
  )

  if (isLoading) {
    return (
      <MainPage loading>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Admin' href='/admin' />
            <MainPageBreadcrumbItem title='Plans' href='/admin/plans' />
            <MainPageBreadcrumbItem title='Loading...' href={`/admin/plans/${planId}`} last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <div className='space-y-6 p-6'>
            <Skeleton className='h-10 w-full' />
            <Skeleton className='h-20 w-full' />
            <Skeleton className='h-10 w-full' />
          </div>
        </MainPageContent>
      </MainPage>
    )
  }

  if (!plan) {
    return (
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Admin' href='/admin' />
            <MainPageBreadcrumbItem title='Plans' href='/admin/plans' />
            <MainPageBreadcrumbItem title='Not Found' href={`/admin/plans/${planId}`} last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <div className='flex flex-col items-center justify-center py-12 gap-4'>
            <p className='text-center text-muted-foreground'>Plan not found</p>
            <Button variant='outline' onClick={() => router.push('/admin/plans')}>
              <ArrowLeft />
              Back to Plans
            </Button>
          </div>
        </MainPageContent>
      </MainPage>
    )
  }

  return <PlanEditForm plan={plan} />
}

/**
 * Inner form component — only rendered when plan data is available.
 */
function PlanEditForm({ plan }: { plan: any }) {
  const router = useRouter()
  const utils = api.useUtils()

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isDirty },
  } = useForm<PlanFormData>({
    defaultValues: {
      name: plan.name,
      description: plan.description || '',
      features: plan.features || [],
      monthlyPrice: plan.monthlyPrice / 100,
      annualPrice: plan.annualPrice / 100,
      isCustomPricing: plan.isCustomPricing,
      isFree: plan.isFree,
      hasTrial: plan.hasTrial,
      trialDays: plan.trialDays,
      featureLimits: plan.featureLimits || [],
      trialFeatureLimits: plan.trialFeatureLimits || null,
      hierarchyLevel: plan.hierarchyLevel,
      selfServed: plan.selfServed,
      isMostPopular: plan.isMostPopular,
      minSeats: plan.minSeats,
      maxSeats: plan.maxSeats,
    },
  })

  const updatePlan = api.admin.plans.update.useMutation({
    onSuccess: () => {
      utils.admin.plans.getAll.invalidate()
      utils.admin.plans.getById.invalidate({ id: plan.id })
      router.push('/admin/plans')
    },
    onError: (error) => {
      toastError({
        title: 'Failed to update plan',
        description: error.message,
      })
    },
  })

  const onSubmit = (data: PlanFormData) => {
    updatePlan.mutate({
      id: plan.id,
      ...data,
      monthlyPrice: Math.round(data.monthlyPrice * 100),
      annualPrice: Math.round(data.annualPrice * 100),
    })
  }

  // Trial vs regular feature limits toggle
  const [trialMode, setTrialMode] = useState(false)
  const featureLimits = watch('featureLimits')
  const trialFeatureLimits = watch('trialFeatureLimits')
  const hasTrial = watch('hasTrial')

  const handleTrialToggle = (checked: boolean) => {
    if (checked && (!trialFeatureLimits || trialFeatureLimits.length === 0)) {
      setValue('trialFeatureLimits', featureLimits, { shouldDirty: true })
    }
    setTrialMode(checked)
  }

  const activeLimits = trialMode ? (trialFeatureLimits ?? featureLimits) : featureLimits
  const handleFeatureLimitsChange = (limits: FeatureDefinition[]) => {
    if (trialMode) {
      setValue('trialFeatureLimits', limits, { shouldDirty: true })
    } else {
      setValue('featureLimits', limits, { shouldDirty: true })
    }
  }

  return (
    <MainPage>
      <MainPageHeader
        action={
          <Button
            type='submit'
            size='sm'
            form='plan-edit-form'
            loading={updatePlan.isPending}
            disabled={!isDirty}>
            Save Changes
          </Button>
        }>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Admin' href='/admin' />
          <MainPageBreadcrumbItem title='Plans' href='/admin/plans' />
          <MainPageBreadcrumbItem title={plan.name} href={`/admin/plans/${plan.id}`} last />
        </MainPageBreadcrumb>
      </MainPageHeader>
      <MainPageContent>
        <form
          id='plan-edit-form'
          onSubmit={handleSubmit(onSubmit)}
          className='flex-1 overflow-hidden flex flex-col min-h-0 relative'>
          <div className='overflow-auto flex-1 relative'>
            <div className='grid lg:grid-cols-4'>
              {/* Left column */}
              <div className='col-span-2'>
                <PlanDetailsCard
                  register={register}
                  errors={errors}
                  watch={watch}
                  setValue={setValue}
                  plan={plan}
                />

                <Card className='border-none rounded-none shadow-none'>
                  <CardHeader>
                    <CardTitle>Features</CardTitle>
                    <CardDescription>Marketing features list shown to users</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <FeaturesListEditor
                      features={watch('features')}
                      onChange={(features) => setValue('features', features, { shouldDirty: true })}
                    />
                  </CardContent>
                </Card>
              </div>

              {/* Right column */}
              <div className='col-span-2'>
                <FeatureLimitsCard
                  limits={activeLimits}
                  onChange={handleFeatureLimitsChange}
                  trialMode={trialMode}
                  onTrialModeChange={handleTrialToggle}
                  showTrialToggle={hasTrial}
                />
              </div>
            </div>
          </div>
        </form>
      </MainPageContent>
    </MainPage>
  )
}
