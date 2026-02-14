// apps/web/src/app/(protected)/subscription/convert/addons/page.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Input } from '@auxx/ui/components/input'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Users } from 'lucide-react'
import Link from 'next/link'
import { TooltipExplanation } from '~/components/global/tooltip'
import { useConvert } from '../_components/convert-provider'

/** Addons configuration page for subscription conversion */
export default function AddonsConvertPage() {
  const { state, isLoading, updateAddons, markStepCompleted, setCurrentStep } = useConvert()

  const handleContinue = () => {
    markStepCompleted(2)
    setCurrentStep(3) // Navigate to summary
  }

  if (isLoading || !state.selectedPlan) {
    return (
      <div className='mx-auto max-w-2xl p-6 space-y-6'>
        <Skeleton className='h-32 w-full' />
        <Skeleton className='h-20 w-full' />
        <Skeleton className='h-32 w-full' />
        <Skeleton className='h-10 w-full' />
      </div>
    )
  }

  const basePrice =
    (state.billingCycle === 'MONTHLY'
      ? state.selectedPlan.monthlyPrice
      : state.selectedPlan.annualPrice / 12) / 100
  const totalPrice = basePrice * state.addons.seats

  return (
    <div className='mx-auto max-w-xl p-6 space-y-3'>
      {/* Plan Display Card */}
      <Card className='shadow-md shadow-black/20 border-transparent'>
        <CardHeader>
          <CardTitle className='text-2xl mb-0'>{state.selectedPlan.name} Plan</CardTitle>
          <CardDescription>
            <div className='flex items-center flex-row gap-1'>
              <span className='font-semibold text-lg text-foreground'>${basePrice}</span>
              <span className='text-sm text-muted-foreground'>per user/month</span>
              <TooltipExplanation
                text={`Billed ${state.billingCycle.toLowerCase()}`}></TooltipExplanation>
            </div>
          </CardDescription>
        </CardHeader>
        <CardContent className='pt-6'>
          <div className='flex justify-between mb-4'>
            <div>
              <CardTitle>Team Size</CardTitle>
              <CardDescription>Add seats for your team members</CardDescription>
            </div>
            <div className='flex flex-row gap-2 text-sm'>
              <span className='text-muted-foreground'>
                ({state.addons.seats}x ${basePrice.toFixed(2)})
              </span>
              <span>${totalPrice.toFixed(2)}</span>
            </div>
          </div>
          <div className='group flex items-center justify-between rounded-2xl border py-2 px-3 hover:bg-muted transition-colors duration-200'>
            <div className='flex flex-row items-center gap-2'>
              <div className='size-8 border bg-muted rounded-lg flex items-center justify-center group-hover:bg-secondary transition-colors shrink-0'>
                <Users className='size-4' />
              </div>
              <div className='flex flex-col'>
                <span className='text-sm font-medium'>Seats</span>
                <span className='text-xs text-muted-foreground'>
                  Purchase additional seats to add more users
                </span>
              </div>
            </div>
            <Input
              type='number'
              min={state.selectedPlan.minSeats}
              max={state.selectedPlan.maxSeats}
              value={state.addons.seats}
              onChange={(e) => updateAddons({ seats: Math.max(1, parseInt(e.target.value) || 1) })}
              className='w-20'
            />
          </div>

          {/* <div className="flex items-center justify-center text-sm">
            <span className="text-muted-foreground">Billing:</span>
            <span className="ml-2 font-medium capitalize">{state.billingCycle.toLowerCase()}</span>
          </div> */}
        </CardContent>
      </Card>

      <div className='flex items-center justify-between w-full'>
        <Button variant='outline' asChild size='sm'>
          <Link href='/subscription/convert/explore'>Back</Link>
        </Button>
        <Button onClick={handleContinue} size='sm'>
          Continue
        </Button>
      </div>
    </div>
  )
}
