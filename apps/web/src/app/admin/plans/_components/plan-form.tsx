// apps/web/src/app/admin/plans/_components/plan-form.tsx
/**
 * Plan form component for create/edit
 */
'use client'

import type { FeatureDefinition } from '@auxx/lib/permissions/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { Switch } from '@auxx/ui/components/switch'
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError } from '@auxx/ui/components/toast'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { FeatureLimitsCard } from '~/app/admin/_components/features'
import { api } from '~/trpc/react'
import { FeaturesListEditor } from './features-list-editor'
import type { PlanFormData } from './plan-form-types'
import { StripeSync } from './stripe-sync'

/**
 * Plan form component props
 */
interface PlanFormProps {
  plan?: any // Existing plan for edit mode
}

/**
 * Plan form component for create/edit
 */
export function PlanForm({ plan }: PlanFormProps) {
  const router = useRouter()
  const utils = api.useUtils()
  const isEditMode = !!plan

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isDirty },
  } = useForm<PlanFormData>({
    defaultValues: plan
      ? {
          name: plan.name,
          description: plan.description || '',
          features: plan.features || [],
          monthlyPrice: plan.monthlyPrice / 100, // Convert cents to dollars
          annualPrice: plan.annualPrice / 100,
          isCustomPricing: plan.isCustomPricing,
          isFree: plan.isFree,
          hasTrial: plan.hasTrial,
          trialDays: plan.trialDays,
          featureLimits: plan.featureLimits || [],
          hierarchyLevel: plan.hierarchyLevel,
          selfServed: plan.selfServed,
          isMostPopular: plan.isMostPopular,
          minSeats: plan.minSeats,
          maxSeats: plan.maxSeats,
        }
      : {
          name: '',
          description: '',
          features: [],
          monthlyPrice: 0,
          annualPrice: 0,
          isCustomPricing: false,
          isFree: false,
          hasTrial: false,
          trialDays: 14,
          featureLimits: [],
          hierarchyLevel: 0,
          selfServed: true,
          isMostPopular: false,
          minSeats: 1,
          maxSeats: 10,
        },
  })

  const createPlan = api.admin.plans.create.useMutation({
    onSuccess: () => {
      utils.admin.plans.getAll.invalidate()
      router.push('/admin/plans')
    },
    onError: (error) => {
      toastError({
        title: 'Failed to create plan',
        description: error.message,
      })
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
    // Convert dollars to cents
    const payload = {
      ...data,
      monthlyPrice: Math.round(data.monthlyPrice * 100),
      annualPrice: Math.round(data.annualPrice * 100),
    }

    if (isEditMode) {
      updatePlan.mutate({ id: plan.id, ...payload })
    } else {
      createPlan.mutate(payload)
    }
  }

  const watchHasTrial = watch('hasTrial')
  const watchIsCustomPricing = watch('isCustomPricing')
  const watchIsFree = watch('isFree')

  return (
    <form onSubmit={handleSubmit(onSubmit)} className='space-y-6'>
      {/* Basic Information */}
      <Card>
        <CardHeader>
          <CardTitle className='text-lg'>Basic Information</CardTitle>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='name'>Plan Name</Label>
            <Input
              id='name'
              {...register('name', { required: 'Plan name is required' })}
              placeholder='e.g. Starter, Growth, Enterprise'
            />
            {errors.name && <p className='text-sm text-destructive'>{errors.name.message}</p>}
          </div>

          <div className='space-y-2'>
            <Label htmlFor='description'>Description</Label>
            <Textarea
              id='description'
              {...register('description', { required: 'Description is required' })}
              placeholder='Brief description of this plan'
              rows={3}
            />
            {errors.description && (
              <p className='text-sm text-destructive'>{errors.description.message}</p>
            )}
          </div>

          <div className='space-y-2'>
            <Label htmlFor='hierarchyLevel'>Hierarchy Level</Label>
            <Input
              id='hierarchyLevel'
              type='number'
              {...register('hierarchyLevel', { valueAsNumber: true })}
              placeholder='0'
            />
            <p className='text-xs text-muted-foreground'>
              Lower numbers appear first (0 = Free, 1 = Starter, 2 = Growth, 3 = Enterprise)
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Pricing */}
      <Card>
        <CardHeader>
          <CardTitle className='text-lg'>Pricing</CardTitle>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex items-center gap-2'>
            <Switch
              id='isFree'
              checked={watchIsFree}
              onCheckedChange={(checked) => setValue('isFree', checked, { shouldDirty: true })}
            />
            <Label htmlFor='isFree' className='cursor-pointer'>
              Free Plan
            </Label>
          </div>

          <div className='flex items-center gap-2'>
            <Switch
              id='isCustomPricing'
              checked={watchIsCustomPricing}
              onCheckedChange={(checked) =>
                setValue('isCustomPricing', checked, { shouldDirty: true })
              }
            />
            <Label htmlFor='isCustomPricing' className='cursor-pointer'>
              Custom Pricing
            </Label>
          </div>

          {!watchIsCustomPricing && !watchIsFree && (
            <>
              <div className='space-y-2'>
                <Label htmlFor='monthlyPrice'>Monthly Price (USD)</Label>
                <Input
                  id='monthlyPrice'
                  type='number'
                  step='0.01'
                  {...register('monthlyPrice', { valueAsNumber: true })}
                  placeholder='0.00'
                />
              </div>

              <div className='space-y-2'>
                <Label htmlFor='annualPrice'>Annual Price (USD)</Label>
                <Input
                  id='annualPrice'
                  type='number'
                  step='0.01'
                  {...register('annualPrice', { valueAsNumber: true })}
                  placeholder='0.00'
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Trial Settings */}
      <Card>
        <CardHeader>
          <CardTitle className='text-lg'>Trial Settings</CardTitle>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex items-center gap-2'>
            <Switch
              id='hasTrial'
              size='sm'
              checked={watchHasTrial}
              onCheckedChange={(checked) => setValue('hasTrial', checked, { shouldDirty: true })}
            />
            <Label htmlFor='hasTrial' className='cursor-pointer'>
              Offer Trial Period
            </Label>
          </div>

          {watchHasTrial && (
            <div className='space-y-2'>
              <Label htmlFor='trialDays'>Trial Days</Label>
              <Input
                id='trialDays'
                type='number'
                {...register('trialDays', { valueAsNumber: true })}
                placeholder='14'
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Features */}
      <Card>
        <CardHeader>
          <CardTitle className='text-lg'>Features</CardTitle>
          <CardDescription>List of features included in this plan</CardDescription>
        </CardHeader>
        <CardContent>
          <FeaturesListEditor
            features={watch('features')}
            onChange={(features) => setValue('features', features, { shouldDirty: true })}
          />
        </CardContent>
      </Card>

      {/* Feature Limits */}
      <FeatureLimitsCard
        limits={watch('featureLimits')}
        onChange={(limits: FeatureDefinition[]) =>
          setValue('featureLimits', limits, { shouldDirty: true })
        }
      />

      {/* Seats */}
      <Card>
        <CardHeader>
          <CardTitle className='text-lg'>Seat Configuration</CardTitle>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='grid grid-cols-2 gap-4'>
            <div className='space-y-2'>
              <Label htmlFor='minSeats'>Minimum Seats</Label>
              <Input
                id='minSeats'
                type='number'
                {...register('minSeats', { valueAsNumber: true })}
                placeholder='1'
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='maxSeats'>Maximum Seats</Label>
              <Input
                id='maxSeats'
                type='number'
                {...register('maxSeats', { valueAsNumber: true })}
                placeholder='10'
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Display Options */}
      <Card>
        <CardHeader>
          <CardTitle className='text-lg'>Display Options</CardTitle>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex items-center gap-2'>
            <Switch
              id='selfServed'
              size='sm'
              {...register('selfServed')}
              checked={watch('selfServed')}
              onCheckedChange={(checked) => setValue('selfServed', checked, { shouldDirty: true })}
            />
            <Label htmlFor='selfServed' className='cursor-pointer'>
              Self-Service (Users can subscribe directly)
            </Label>
          </div>

          <div className='flex items-center gap-2'>
            <Switch
              id='isMostPopular'
              size='sm'
              {...register('isMostPopular')}
              checked={watch('isMostPopular')}
              onCheckedChange={(checked) =>
                setValue('isMostPopular', checked, { shouldDirty: true })
              }
            />
            <Label htmlFor='isMostPopular' className='cursor-pointer'>
              Mark as Most Popular
            </Label>
          </div>
        </CardContent>
      </Card>

      {/* Stripe Status (Edit mode only) */}
      {isEditMode && (
        <Card>
          <CardHeader>
            <div className='flex items-center justify-between'>
              <CardTitle className='text-lg'>Stripe Integration</CardTitle>
              <StripeSync planId={plan.id} plan={plan} />
            </div>
          </CardHeader>
          <CardContent className='space-y-2'>
            {plan.stripeProductId ? (
              <>
                <div className='flex items-center justify-between'>
                  <span className='text-sm text-muted-foreground'>Product ID:</span>
                  <Badge variant='outline' className='font-mono text-xs'>
                    {plan.stripeProductId}
                  </Badge>
                </div>
                {plan.stripePriceIdMonthly && (
                  <div className='flex items-center justify-between'>
                    <span className='text-sm text-muted-foreground'>Monthly Price ID:</span>
                    <Badge variant='outline' className='font-mono text-xs'>
                      {plan.stripePriceIdMonthly}
                    </Badge>
                  </div>
                )}
                {plan.stripePriceIdAnnual && (
                  <div className='flex items-center justify-between'>
                    <span className='text-sm text-muted-foreground'>Annual Price ID:</span>
                    <Badge variant='outline' className='font-mono text-xs'>
                      {plan.stripePriceIdAnnual}
                    </Badge>
                  </div>
                )}
              </>
            ) : (
              <div className='text-sm text-muted-foreground'>
                Not synced to Stripe. Click "Sync to Stripe" to create Stripe resources.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <div className='flex items-center justify-end gap-2'>
        <Button
          type='button'
          variant='outline'
          onClick={() => router.push('/admin/plans')}
          disabled={createPlan.isPending || updatePlan.isPending}>
          Cancel
        </Button>
        <Button
          type='submit'
          loading={createPlan.isPending || updatePlan.isPending}
          disabled={!isDirty}>
          {isEditMode ? 'Update Plan' : 'Create Plan'}
        </Button>
      </div>
    </form>
  )
}
