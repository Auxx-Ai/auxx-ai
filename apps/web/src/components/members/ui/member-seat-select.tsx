// apps/web/src/components/members/ui/member-seat-select.tsx
'use client'

import type { SeatType } from '@auxx/database/types'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { HardHat, UserCircle2 } from 'lucide-react'

interface MemberSeatSelectProps {
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
    label: 'Full seat',
    description: 'Billed as a full member',
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
 * The seat-change control — the ONE surface that moves a member between seat
 * classes, reached from the members-list row menu (§0.21). This is a billing
 * event: the server runs the shared cap gate (`assertSeatAvailable`) before the
 * write, so nothing here hand-rolls a limit check.
 *
 * Seat class is named outright rather than implied (§0.22). The DB value stays
 * `'worker'`; the label is always "Field seat".
 */
export function MemberSeatSelect({ value, onChange, disabled, className }: MemberSeatSelectProps) {
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
