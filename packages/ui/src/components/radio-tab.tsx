/**
 * RadioTab Component
 *
 * A reusable radio tab component that provides a tabbed interface using radio buttons.
 * Supports controlled and uncontrolled usage patterns.
 *
 * @example
 * ```tsx
 * // Controlled usage
 * const [value, setValue] = useState('option1')
 * <RadioTab value={value} onValueChange={setValue}>
 *   <RadioTabItem value="option1">Option 1</RadioTabItem>
 *   <RadioTabItem value="option2">Option 2</RadioTabItem>
 * </RadioTab>
 *
 * // Uncontrolled usage
 * <RadioTab defaultValue="option1">
 *   <RadioTabItem value="option1">Option 1</RadioTabItem>
 *   <RadioTabItem value="option2">Option 2</RadioTabItem>
 * </RadioTab>
 * ```
 */
'use client'

import * as React from 'react'
import { useId, useState } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@auxx/ui/lib/utils'
import { RadioGroup, RadioGroupItem } from '@auxx/ui/components/radio-group'
import { Tooltip, TooltipTrigger, TooltipContent } from '@auxx/ui/components/tooltip'

/**
 * Variants for the RadioTab container component using class-variance-authority
 */
const radioTabVariants = cva('inline-flex rounded-md p-0.5', {
  variants: { variant: { default: 'bg-input/50' }, size: { default: 'h-9', sm: 'h-8', xs: 'h-6' } },
  defaultVariants: { variant: 'default', size: 'default' },
})

/**
 * Variants for the RadioGroup inside the RadioTab
 */
const radioGroupVariants = cva(
  'group relative shrink-0 inline-grid items-center gap-0 text-sm font-medium after:absolute after:inset-y-0 after:rounded-sm after:shadow-xs after:transition-transform after:duration-300 after:ease-[cubic-bezier(0.16,1,0.3,1)] after:bg-background dark:after:bg-white/10 has-focus-visible:after:border-ring has-focus-visible:after:ring-info/50 has-focus-visible:after:ring-[2px]',
  {
    variants: { size: { default: '', sm: 'text-xs', xs: 'text-xs' } },
    defaultVariants: { size: 'default' },
  }
)

/**
 * Variants for individual RadioTabItem labels
 */
const radioTabItemVariants = cva(
  'relative z-10 inline-flex h-full cursor-pointer items-center shrink-0 gap-2 whitespace-nowrap justify-center whitespace-nowrap transition-colors select-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      size: { default: 'min-w-8 px-4', sm: 'min-w-6 px-3', xs: 'size-5 [&_svg]:size-3' },
    },
    defaultVariants: { size: 'default' },
  }
)

/**
 * Props for the RadioTab component
 */
export interface RadioTabProps
  extends Omit<React.ComponentProps<typeof RadioGroup>, 'className'>,
    VariantProps<typeof radioTabVariants> {
  /** Custom className for the container */
  className?: string
  /** Custom className for the RadioGroup */
  radioGroupClassName?: string
  /** Children RadioTabItem components */
  children: React.ReactNode
}

/**
 * Props for the RadioTabItem component
 */
export interface RadioTabItemProps extends VariantProps<typeof radioTabItemVariants> {
  /** The value for this radio item */
  value: string
  /** Custom className for the label */
  className?: string
  /** Children content for the tab item */
  children: React.ReactNode
  /** Internal prop passed from parent RadioTab */
  id?: string
  /** Whether the tab item is disabled */
  disabled?: boolean
  /** Optional tooltip text to display on hover */
  tooltip?: string
}

/**
 * Context to share size and other props between RadioTab and RadioTabItem
 */
const RadioTabContext = React.createContext<{ size: 'default' | 'sm'; totalItems: number }>({
  size: 'default',
  totalItems: 2,
})

/**
 * Main RadioTab container component that provides a tabbed radio group interface
 */
function RadioTab({
  className,
  radioGroupClassName,
  variant,
  size,
  children,
  ...props
}: RadioTabProps) {
  const baseId = useId()
  const [internalValue, setInternalValue] = useState<string>('')

  // Count children to determine grid layout
  const childrenArray = React.Children.toArray(children)
  const totalItems = childrenArray.length

  // Use controlled value if provided, otherwise use internal state
  const isControlled = props.value !== undefined
  const currentValue = isControlled ? props.value : internalValue
  const handleValueChange = isControlled ? props.onValueChange : setInternalValue

  // Generate grid classes and indicator positioning
  const getGridClasses = () => {
    switch (totalItems) {
      case 2:
        return 'grid-cols-2'
      case 3:
        return 'grid-cols-3'
      case 4:
        return 'grid-cols-4'
      case 5:
        return 'grid-cols-5'
      case 6:
        return 'grid-cols-6'
      default:
        return 'grid-cols-2'
    }
  }

  const getIndicatorClasses = (value: string) => {
    const index = childrenArray.findIndex(
      (child) => React.isValidElement(child) && child.props.value === value
    )

    const widthClass =
      totalItems === 2
        ? 'after:w-1/2'
        : totalItems === 3
          ? 'after:w-1/3'
          : totalItems === 4
            ? 'after:w-1/4'
            : totalItems === 5
              ? 'after:w-1/5'
              : totalItems === 6
                ? 'after:w-1/6'
                : 'after:w-1/2'

    const translateClass =
      index === 0
        ? 'after:translate-x-0'
        : index === 1
          ? 'after:translate-x-full'
          : index === 2
            ? 'after:translate-x-[200%]'
            : index === 3
              ? 'after:translate-x-[300%]'
              : index === 4
                ? 'after:translate-x-[400%]'
                : index === 5
                  ? 'after:translate-x-[500%]'
                  : 'after:translate-x-0'

    return `${widthClass} ${translateClass}`
  }

  return (
    <div className={cn(radioTabVariants({ variant, size }), className)}>
      <RadioTabContext.Provider value={{ size: size || 'default', totalItems }}>
        <RadioGroup
          value={currentValue}
          onValueChange={handleValueChange}
          className={cn(
            radioGroupVariants({ size }),
            getGridClasses(),
            getIndicatorClasses(currentValue || ''),
            radioGroupClassName
          )}
          data-state={currentValue}
          {...props}>
          {childrenArray.map((child, index) => {
            if (React.isValidElement<RadioTabItemProps>(child) && child.type === RadioTabItem) {
              return React.cloneElement(child, {
                key: child.props.value || index,
                id: `${baseId}-${index + 1}`,
              } as Partial<RadioTabItemProps>)
            }
            return child
          })}
        </RadioGroup>
      </RadioTabContext.Provider>
    </div>
  )
}

/**
 * Individual tab item component for use within RadioTab
 */
function RadioTabItem({
  className,
  size,
  value,
  children,
  id,
  disabled,
  tooltip,
  ...props
}: RadioTabItemProps) {
  const context = React.useContext(RadioTabContext)
  const effectiveSize = size || context.size

  const label = (
    <label
      className={cn(
        radioTabItemVariants({ size: effectiveSize }),
        'group-data-[state=' + value + ']:text-foreground',
        'group-data-[state!=' + value + ']:text-muted-foreground/70',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
      {...props}>
      {children}
      <RadioGroupItem id={id} value={value} className="sr-only" disabled={disabled} />
    </label>
  )

  if (tooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{label}</TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    )
  }

  return label
}

export { RadioTab, RadioTabItem, radioTabVariants }
