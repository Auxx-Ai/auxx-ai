// apps/web/src/app/(protected)/subscription/convert/explore/page.tsx
'use client'

import { PlanComparison, type Plan } from '~/components/subscriptions/plan-comparison'
import { useConvert } from '../_components/convert-provider'
import { Card } from '@auxx/ui/components/card'
import { Button } from '@auxx/ui/components/button'
import Link from 'next/link'

/** Plan exploration page for subscription conversion */
export default function ExploreConvertPage() {
  const { updateSelectedPlan, markStepCompleted, setCurrentStep } = useConvert()

  const handlePlanSelect = (plan: Plan) => {
    updateSelectedPlan(plan)
    markStepCompleted(1)
    setCurrentStep(2) // Navigate to addons
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Card className="w-full shadow-md shadow-black/20 border-transparent mx-auto">
        <PlanComparison onPlanSelect={handlePlanSelect} />
      </Card>
      <div>
        <Button size="sm" variant="outline" asChild className="mt-3">
          <Link href="/subscription/ended">Back</Link>
        </Button>
      </div>
    </div>
  )
}
