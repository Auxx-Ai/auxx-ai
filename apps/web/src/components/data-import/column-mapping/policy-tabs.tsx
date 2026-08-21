// apps/web/src/components/data-import/column-mapping/policy-tabs.tsx

'use client'

import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'

/** One segment of a policy tab strip, plus the reason it matters. */
export interface PolicyTabOption<T extends string = string> {
  value: T
  /** Short enough to fit the strip. The sentence goes in `description`. */
  label: string
  description: string
  disabled?: boolean
  /** Shown on hover when the segment is unavailable. */
  tooltip?: string
  /** Small emphasised word after the description, e.g. `recommended`. */
  badge?: string
}

interface PolicyTabsProps<T extends string> {
  value: T
  options: PolicyTabOption<T>[]
  onValueChange: (value: T) => void
}

/**
 * A policy choice as a segmented control, with the selected option's
 * consequence spelled out underneath.
 *
 * The description is not decoration. Every choice here is destructive in some
 * direction, and a bare label like "Overwrite" or "Update" does not say what it
 * costs, so the sentence for the ACTIVE option is always on screen.
 */
export function PolicyTabs<T extends string>({
  value,
  options,
  onValueChange,
}: PolicyTabsProps<T>) {
  const active = options.find((option) => option.value === value)

  return (
    <>
      <RadioTab
        value={value}
        onValueChange={(next) => onValueChange(next as T)}
        size='sm'
        radioGroupClassName='grid w-full'
        className='border border-primary-200 flex w-full'>
        {options.map((option) => (
          <RadioTabItem
            key={option.value}
            value={option.value}
            size='sm'
            disabled={option.disabled}
            tooltip={option.tooltip}
            className='px-2'>
            {option.label}
          </RadioTabItem>
        ))}
      </RadioTab>
      {active && (
        <p className='mt-2 text-xs text-muted-foreground leading-snug'>
          {active.badge && <span className='font-medium text-info'>{active.badge} </span>}
          {active.description}
        </p>
      )}
    </>
  )
}
