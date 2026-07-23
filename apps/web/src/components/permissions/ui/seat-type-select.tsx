// apps/web/src/components/permissions/ui/seat-type-select.tsx
'use client'

import type { SeatType } from '@auxx/database/types'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { HardHat, UserCircle2 } from 'lucide-react'

interface SeatTypeSelectProps {
  /** Currently selected seat type (controlled). */
  value: SeatType
  onChange: (value: SeatType) => void
  disabled?: boolean
  className?: string
}

const OPTIONS: Array<{
  value: SeatType
  label: string
  description: string
  icon: typeof UserCircle2
}> = [
  {
    value: 'full',
    label: 'Full member',
    description: 'Full access, governed by role',
    icon: UserCircle2,
  },
  {
    value: 'worker',
    label: 'Field seat',
    description: 'Schedule + assigned jobs only',
    icon: HardHat,
  },
]

/**
 * Controlled segmented two-option control for choosing a member's seat type
 * (Full member / Field seat) — shared by the invite flow and the members-list
 * row switcher. Naming per §11.1: the DB value stays `'worker'`, the label is
 * always "Field seat".
 */
export function SeatTypeSelect({ value, onChange, disabled, className }: SeatTypeSelectProps) {
  return (
    <div className={cn('grid grid-cols-2 gap-2', className)}>
      {OPTIONS.map((option) => {
        const selected = value === option.value
        const Icon = option.icon
        return (
          <Button
            key={option.value}
            type='button'
            variant={selected ? 'default' : 'outline'}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            aria-pressed={selected}
            className='h-auto flex-col items-start gap-1 py-2 text-left whitespace-normal'>
            <span className='flex items-center gap-1.5 font-medium'>
              <Icon />
              {option.label}
            </span>
            <span
              className={cn(
                'text-xs font-normal',
                selected ? 'text-primary-foreground/80' : 'text-muted-foreground'
              )}>
              {option.description}
            </span>
          </Button>
        )
      })}
    </div>
  )
}
