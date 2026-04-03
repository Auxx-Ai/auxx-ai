// apps/web/src/components/kopilot/ui/blocks/plan-steps-block.tsx

import { Check, Circle, Loader2, X } from 'lucide-react'
import type { BlockRendererProps } from './block-registry'
import type { PlanStepsData } from './block-schemas'

const STATUS_ICONS = {
  completed: <Check className='size-3.5 text-green-500' />,
  running: <Loader2 className='size-3.5 animate-spin text-blue-500' />,
  failed: <X className='size-3.5 text-destructive' />,
  pending: <Circle className='size-3.5 text-muted-foreground/50' />,
} as const

export function PlanStepsBlock({ data }: BlockRendererProps<PlanStepsData>) {
  return (
    <div className='not-prose my-2 rounded-lg border px-3 py-2.5'>
      <div className='mb-2 text-xs font-medium text-muted-foreground'>Plan</div>
      <div className='space-y-1.5'>
        {data.steps.map((step, i) => (
          <div key={i} className='flex items-start gap-2 text-sm'>
            <span className='mt-0.5 shrink-0'>{STATUS_ICONS[step.status]}</span>
            <div className='min-w-0'>
              <span className={step.status === 'pending' ? 'text-muted-foreground' : ''}>
                {step.label}
              </span>
              {step.detail && (
                <span className='ml-1 text-xs text-muted-foreground'>— {step.detail}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
