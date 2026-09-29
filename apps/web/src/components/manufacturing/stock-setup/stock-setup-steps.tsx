// apps/web/src/components/manufacturing/stock-setup/stock-setup-steps.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { Check } from 'lucide-react'
import type { StockSetupStep } from './stock-setup-href'
import { STOCK_SETUP_STEPS, type StockSetupStepState } from './use-stock-setup'

const STATE_LABEL: Record<StockSetupStepState, string> = {
  todo: 'To do',
  done: 'Done',
  skipped: 'Skipped',
}

interface StockSetupStepsProps {
  states: Record<StockSetupStep, StockSetupStepState>
  selected: StockSetupStep
  onSelect: (step: StockSetupStep) => void
}

/** The four steps across the top of Stock setup: number, name and state. */
export function StockSetupSteps({ states, selected, onSelect }: StockSetupStepsProps) {
  return (
    <nav aria-label='Stock setup steps' className='grid shrink-0 grid-cols-4 border-b'>
      {STOCK_SETUP_STEPS.map((step, index) => {
        const state = states[step.id]
        const active = step.id === selected
        return (
          <button
            key={step.id}
            type='button'
            aria-current={active ? 'step' : undefined}
            onClick={() => onSelect(step.id)}
            className={cn(
              'flex min-w-0 items-center gap-2 border-b-2 px-3 py-2.5 text-left transition-colors sm:gap-3 sm:px-4',
              active
                ? 'border-primary bg-background'
                : 'border-transparent text-muted-foreground hover:bg-muted/50'
            )}>
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full border font-medium text-xs',
                state === 'done' && 'border-transparent bg-good-500 text-white',
                state === 'skipped' && 'border-dashed',
                active && state === 'todo' && 'border-primary text-foreground'
              )}>
              {state === 'done' ? <Check className='size-3.5' /> : index + 1}
            </span>
            <span className='flex min-w-0 flex-col'>
              <span className='truncate font-medium text-foreground text-sm'>{step.name}</span>
              <span className='truncate text-muted-foreground text-xs'>{STATE_LABEL[state]}</span>
            </span>
          </button>
        )
      })}
    </nav>
  )
}
