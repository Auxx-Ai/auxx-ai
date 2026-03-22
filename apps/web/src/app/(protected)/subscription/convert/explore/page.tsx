// apps/web/src/app/(protected)/subscription/convert/explore/page.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Card } from '@auxx/ui/components/card'
import Link from 'next/link'
import { type Plan, PlanComparison } from '~/components/subscriptions/plan-comparison'
import { useConvert } from '../_components/convert-provider'

/** Plan exploration page for subscription conversion */
export default function ExploreConvertPage() {
  const { updateSelectedPlan, markStepCompleted, setCurrentStep } = useConvert()

  const handlePlanSelect = (plan: Plan) => {
    updateSelectedPlan(plan)
    markStepCompleted(1)
    setCurrentStep(2) // Navigate to addons
  }

  return (
    <div className='mx-auto max-w-3xl'>
      <Card
        variant='translucent'
        className='w-full shadow-md shadow-black/20 border-transparent mx-auto'>
        <PlanComparison onPlanSelect={handlePlanSelect} variant='translucent' />
      </Card>
      <div>
        <Button size='sm' variant='translucent' asChild className='mt-3'>
          <Link href='/subscription/ended'>Back</Link>
        </Button>
      </div>
    </div>
  )
}
