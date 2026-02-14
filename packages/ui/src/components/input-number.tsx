// packages/ui/src/components/input-number.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { ChevronDown, ChevronUp, Minus, Plus } from 'lucide-react'
import * as React from 'react'
import { clampValue, decrementValue, incrementValue } from './input-number-utils'

// ============================================================================
// Types & Interfaces
// ============================================================================

/**
 * Context value provided by NumberInput to all child components
 */
interface NumberInputContextValue {
  /** Current number value */
  value: number | undefined
  /** Whether the input is disabled */
  disabled?: boolean
  /** Whether the input is read-only */
  readOnly?: boolean
  /** Minimum allowed value */
  min?: number
  /** Maximum allowed value */
  max?: number
  /** Step increment/decrement amount */
  step: number
  /** Intl.NumberFormat options for display formatting */
  formatOptions?: Intl.NumberFormatOptions
  /** Locale for number formatting */
  locale?: string
  /** Increment the value by step amount */
  increment: () => void
  /** Decrement the value by step amount */
  decrement: () => void
  /** Set a new value with validation and clamping */
  setValue: (value: number | undefined) => void
  /** Whether scrubbing is currently active */
  isScrubbing: boolean
  /** Start scrubbing mode */
  startScrubbing: () => void
  /** Stop scrubbing mode */
  stopScrubbing: () => void
  /** Register a function to commit pending display value (called by NumberInputField) */
  registerCommitFn: (fn: () => void) => void
  /** Commit any pending typed value before increment/decrement */
  commitPendingValue: () => void
}

/**
 * Props for the NumberInput root component (context provider)
 */
export interface NumberInputProps extends React.PropsWithChildren {
  /** Controlled value */
  value?: number
  /** Default value for uncontrolled mode */
  defaultValue?: number
  /** Callback when value changes */
  onValueChange?: (value: number | undefined) => void
  /** Minimum allowed value */
  min?: number
  /** Maximum allowed value */
  max?: number
  /** Step increment/decrement amount (default: 1) */
  step?: number
  /** Intl.NumberFormat options for display formatting */
  formatOptions?: Intl.NumberFormatOptions
  /** Locale for number formatting (default: 'en-US') */
  locale?: string
  /** Whether the input is disabled */
  disabled?: boolean
  /** Whether the input is read-only */
  readOnly?: boolean
}

/**
 * Props for the NumberInputField component
 */
export interface NumberInputFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  // Value and constraints come from context
}

/**
 * Props for the NumberInputScrubber component
 */
export interface NumberInputScrubberProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  /** ID of the input element to connect to (required) */
  htmlFor: string
  /** How fast value changes when scrubbing (default: 1) */
  sensitivity?: number
  /** Label text */
  children: React.ReactNode
}

/**
 * Props for the NumberInputIncrement/Decrement components
 */
export interface NumberInputStepperProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  // Uses context for increment/decrement functions
}

/**
 * Props for the NumberInputArrows component
 */
export interface NumberInputArrowsProps extends React.HTMLAttributes<HTMLDivElement> {
  // Container div props
}

// ============================================================================
// Context
// ============================================================================

/** Context for NumberInput state and actions */
const NumberInputContext = React.createContext<NumberInputContextValue | undefined>(undefined)

/**
 * Hook to access NumberInput context
 * @throws Error if used outside NumberInput provider
 */
function useNumberInput() {
  const context = React.useContext(NumberInputContext)
  if (!context) {
    throw new Error('NumberInput components must be used within a NumberInput provider')
  }
  return context
}

// ============================================================================
// NumberInput (Root Component)
// ============================================================================

/**
 * NumberInput root component that provides context for number input behavior.
 * This component does NOT render any DOM elements - it only provides context.
 *
 * @example
 * ```tsx
 * <NumberInput value={timeout} onValueChange={setTimeout} min={0} step={1}>
 *   <NumberInputScrubber htmlFor="timeout">Connection</NumberInputScrubber>
 *   <InputGroup>
 *     <NumberInputField id="timeout" placeholder="10" />
 *     <InputGroupAddon align="inline-end">
 *       <InputGroupText>s</InputGroupText>
 *     </InputGroupAddon>
 *   </InputGroup>
 * </NumberInput>
 * ```
 */
function NumberInput({
  value: controlledValue,
  defaultValue,
  onValueChange,
  min,
  max,
  step = 1,
  formatOptions,
  locale = 'en-US',
  disabled = false,
  readOnly = false,
  children,
}: NumberInputProps) {
  // Determine if component is controlled
  const isControlled = controlledValue !== undefined

  // Internal state for uncontrolled mode
  const [uncontrolledValue, setUncontrolledValue] = React.useState<number | undefined>(defaultValue)

  // Use controlled value if provided, otherwise use internal state
  const value = isControlled ? controlledValue : uncontrolledValue

  // Track scrubbing state
  const [isScrubbing, setIsScrubbing] = React.useState(false)

  // Ref to store the commit function from NumberInputField
  const commitFnRef = React.useRef<(() => void) | null>(null)

  /**
   * Register a function to commit pending display value
   * Called by NumberInputField to register its commit function
   */
  const registerCommitFn = React.useCallback((fn: () => void) => {
    commitFnRef.current = fn
  }, [])

  /**
   * Commit any pending typed value before increment/decrement
   * Called by NumberInputIncrement/Decrement before operating
   */
  const commitPendingValue = React.useCallback(() => {
    commitFnRef.current?.()
  }, [])

  /**
   * Set value with validation and clamping
   */
  const setValue = React.useCallback(
    (newValue: number | undefined) => {
      const clampedValue = clampValue(newValue, min, max)

      if (!isControlled) {
        setUncontrolledValue(clampedValue)
      }

      onValueChange?.(clampedValue)
    },
    [isControlled, min, max, onValueChange]
  )

  /**
   * Increment value by step amount
   */
  const increment = React.useCallback(() => {
    if (disabled || readOnly) return
    const newValue = incrementValue(value, step, max)
    setValue(newValue)
  }, [disabled, readOnly, value, step, max, setValue])

  /**
   * Decrement value by step amount
   */
  const decrement = React.useCallback(() => {
    if (disabled || readOnly) return
    const newValue = decrementValue(value, step, min)
    setValue(newValue)
  }, [disabled, readOnly, value, step, min, setValue])

  /**
   * Start scrubbing mode
   */
  const startScrubbing = React.useCallback(() => {
    setIsScrubbing(true)
  }, [])

  /**
   * Stop scrubbing mode
   */
  const stopScrubbing = React.useCallback(() => {
    setIsScrubbing(false)
  }, [])

  const contextValue: NumberInputContextValue = React.useMemo(
    () => ({
      value,
      disabled,
      readOnly,
      min,
      max,
      step,
      formatOptions,
      locale,
      increment,
      decrement,
      setValue,
      isScrubbing,
      startScrubbing,
      stopScrubbing,
      registerCommitFn,
      commitPendingValue,
    }),
    [
      value,
      disabled,
      readOnly,
      min,
      max,
      step,
      formatOptions,
      locale,
      increment,
      decrement,
      setValue,
      isScrubbing,
      startScrubbing,
      stopScrubbing,
      registerCommitFn,
      commitPendingValue,
    ]
  )

  return <NumberInputContext.Provider value={contextValue}>{children}</NumberInputContext.Provider>
}

// ============================================================================
// NumberInputField
// ============================================================================

/**
 * NumberInputField component - the actual input element for number input.
 * Styled to match InputGroupInput and includes keyboard navigation.
 * Use this INSIDE InputGroup components.
 *
 * @example
 * ```tsx
 * <NumberInput value={quantity} onValueChange={setQuantity}>
 *   <InputGroup>
 *     <NumberInputField id="quantity" placeholder="1" />
 *   </InputGroup>
 * </NumberInput>
 * ```
 */
const NumberInputField = React.forwardRef<HTMLInputElement, NumberInputFieldProps>(
  ({ className, onKeyDown, onBlur, ...props }, ref) => {
    const {
      value,
      disabled,
      readOnly,
      min,
      max,
      step,
      increment,
      decrement,
      setValue,
      registerCommitFn,
    } = useNumberInput()

    // Local state to track what the user is typing (allows free typing without clamping)
    const [displayValue, setDisplayValue] = React.useState<string>('')

    // Sync display value with context value when it changes externally
    React.useEffect(() => {
      setDisplayValue(value !== undefined ? String(value) : '')
    }, [value])

    /**
     * Commit the current display value to context (parse and set)
     * This is called by increment/decrement before they operate
     */
    const commitDisplayValue = React.useCallback(() => {
      const inputValue = displayValue.trim()
      if (inputValue === '' || inputValue === '-') {
        setValue(undefined)
        return
      }
      const numValue = parseFloat(inputValue)
      if (!Number.isNaN(numValue)) {
        const clampedValue = clampValue(numValue, min, max)
        setValue(clampedValue)
      }
    }, [displayValue, setValue, min, max])

    // Register the commit function with the context
    React.useEffect(() => {
      registerCommitFn(commitDisplayValue)
    }, [registerCommitFn, commitDisplayValue])

    /**
     * Handle keyboard navigation
     */
    const handleKeyDown = React.useCallback(
      (e: React.KeyboardEvent<HTMLInputElement>) => {
        // Call user's onKeyDown if provided
        onKeyDown?.(e)

        if (disabled || readOnly) return

        switch (e.key) {
          case 'ArrowUp':
            e.preventDefault()
            // Commit typed value first, then increment
            commitDisplayValue()
            increment()
            break
          case 'ArrowDown':
            e.preventDefault()
            // Commit typed value first, then decrement
            commitDisplayValue()
            decrement()
            break
          case 'PageUp':
            e.preventDefault()
            // Commit first, then increment by step * 10
            commitDisplayValue()
            setValue(incrementValue(value, step * 10, max))
            break
          case 'PageDown':
            e.preventDefault()
            // Commit first, then decrement by step * 10
            commitDisplayValue()
            setValue(decrementValue(value, step * 10, min))
            break
          case 'Home':
            if (min !== undefined) {
              e.preventDefault()
              setValue(min)
            }
            break
          case 'End':
            if (max !== undefined) {
              e.preventDefault()
              setValue(max)
            }
            break
        }
      },
      [
        disabled,
        readOnly,
        onKeyDown,
        commitDisplayValue,
        increment,
        decrement,
        setValue,
        value,
        step,
        max,
        min,
      ]
    )

    /**
     * Handle blur - parse, clamp, and sync to context, then call user's onBlur
     */
    const handleBlur = React.useCallback(
      (e: React.FocusEvent<HTMLInputElement>) => {
        // Parse and clamp the value FIRST
        const inputValue = displayValue.trim()
        if (inputValue === '' || inputValue === '-') {
          setValue(undefined)
          setDisplayValue('')
          // Call user's onBlur AFTER value is updated
          onBlur?.(e)
          return
        }

        const numValue = parseFloat(inputValue)
        if (!Number.isNaN(numValue)) {
          // Clamp the value
          const clampedValue = clampValue(numValue, min, max)

          // Update both context and display value immediately
          setValue(clampedValue)
          setDisplayValue(clampedValue !== undefined ? String(clampedValue) : '')
        } else {
          // Invalid input - revert to context value
          setDisplayValue(value !== undefined ? String(value) : '')
        }

        // Call user's onBlur AFTER value is updated
        onBlur?.(e)
      },
      [onBlur, displayValue, setValue, min, max, value]
    )

    /**
     * Handle input change - update display value only (no validation/clamping)
     */
    const handleChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      // Allow free typing - don't validate or clamp here
      setDisplayValue(e.target.value)
    }, [])

    return (
      <input
        ref={ref}
        type='number'
        data-slot='input-group-control'
        role='spinbutton'
        autoComplete='off'
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        value={displayValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        disabled={disabled}
        readOnly={readOnly}
        min={min}
        max={max}
        step={step}
        className={cn(
          // Match InputGroupInput styling
          'flex-1 text-center rounded-none border-0 bg-transparent! shadow-none focus-visible:ring-0 focus-visible:outline-none focus:ring-0 focus:outline-none dark:bg-transparent!',
          // Text sizing
          'text-sm',
          // Hide native number input spinners
          '[&::-webkit-inner-spin-button]:appearance-none',
          '[&::-webkit-outer-spin-button]:appearance-none',
          className
        )}
        {...props}
      />
    )
  }
)
NumberInputField.displayName = 'NumberInputField'

// ============================================================================
// NumberInputScrubber
// ============================================================================

/**
 * NumberInputScrubber component - a label that acts as a drag handle to change the value.
 * Replaces regular label elements to provide tactile control similar to design tools.
 *
 * @example
 * ```tsx
 * <NumberInput value={timeout} onValueChange={setTimeout}>
 *   <NumberInputScrubber htmlFor="timeout" className="mb-1">
 *     Connection
 *   </NumberInputScrubber>
 *   <InputGroup>
 *     <NumberInputField id="timeout" />
 *   </InputGroup>
 * </NumberInput>
 * ```
 */
const NumberInputScrubber = React.forwardRef<HTMLLabelElement, NumberInputScrubberProps>(
  ({ htmlFor, sensitivity = 1, className, children, onMouseDown, ...props }, ref) => {
    const { disabled, readOnly, setValue, value, step, startScrubbing, stopScrubbing } =
      useNumberInput()

    // Track drag state
    const dragStartX = React.useRef<number>(0)
    const dragStartValue = React.useRef<number>(0)

    /**
     * Handle mouse down to start scrubbing
     */
    const handleMouseDown = React.useCallback(
      (e: React.MouseEvent<HTMLLabelElement>) => {
        // Call user's onMouseDown if provided
        onMouseDown?.(e)

        if (disabled || readOnly) return

        e.preventDefault()
        dragStartX.current = e.clientX
        dragStartValue.current = value ?? 0
        startScrubbing()

        // Add global mouse move and mouse up handlers
        const handleMouseMove = (moveEvent: MouseEvent) => {
          const deltaX = moveEvent.clientX - dragStartX.current
          const deltaValue = (deltaX / 10) * step * sensitivity // Adjust sensitivity
          const rawValue = dragStartValue.current + deltaValue

          // Round to nearest step for clean increments
          const newValue = Math.round(rawValue / step) * step
          setValue(newValue)
        }

        const handleMouseUp = () => {
          stopScrubbing()
          document.removeEventListener('mousemove', handleMouseMove)
          document.removeEventListener('mouseup', handleMouseUp)
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
      },
      [
        disabled,
        readOnly,
        onMouseDown,
        value,
        step,
        sensitivity,
        setValue,
        startScrubbing,
        stopScrubbing,
      ]
    )

    return (
      <label
        ref={ref}
        htmlFor={htmlFor}
        onMouseDown={handleMouseDown}
        className={cn(
          'cursor-ew-resize select-none text-xs font-medium',
          'active:cursor-grabbing',
          disabled && 'cursor-not-allowed opacity-50',
          className
        )}
        {...props}>
        {children}
      </label>
    )
  }
)
NumberInputScrubber.displayName = 'NumberInputScrubber'

// ============================================================================
// NumberInputIncrement
// ============================================================================

/**
 * NumberInputIncrement component - button to increment the value.
 * Use this inside InputGroupAddon for explicit increment control.
 *
 * @example
 * ```tsx
 * <NumberInput value={quantity} onValueChange={setQuantity}>
 *   <InputGroup>
 *     <NumberInputField />
 *     <InputGroupAddon align="inline-end">
 *       <NumberInputIncrement />
 *     </InputGroupAddon>
 *   </InputGroup>
 * </NumberInput>
 * ```
 */
const NumberInputIncrement = React.forwardRef<HTMLButtonElement, NumberInputStepperProps>(
  ({ className, onClick, children, ...props }, ref) => {
    const { increment, disabled, readOnly, value, max, commitPendingValue } = useNumberInput()

    const handleClick = React.useCallback(
      (e: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(e)
        if (!e.defaultPrevented) {
          // Commit any typed value before incrementing
          commitPendingValue()
          increment()
        }
      },
      [onClick, commitPendingValue, increment]
    )

    // Disable button if at max value
    const isDisabled =
      disabled || readOnly || (max !== undefined && value !== undefined && value >= max)

    return (
      <button
        ref={ref}
        type='button'
        onClick={handleClick}
        disabled={isDisabled}
        className={cn(
          'flex items-center justify-center size-5.5 rounded cursor-default',
          'text-muted-foreground hover:text-foreground hover:bg-neutral-200 dark:hover:bg-neutral-800',
          'transition-colors',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          className
        )}
        aria-label='Increment'
        {...props}>
        {children || <Plus className='size-4' />}
      </button>
    )
  }
)
NumberInputIncrement.displayName = 'NumberInputIncrement'

// ============================================================================
// NumberInputDecrement
// ============================================================================

/**
 * NumberInputDecrement component - button to decrement the value.
 * Use this inside InputGroupAddon for explicit decrement control.
 *
 * @example
 * ```tsx
 * <NumberInput value={quantity} onValueChange={setQuantity}>
 *   <InputGroup>
 *     <InputGroupAddon align="inline-start">
 *       <NumberInputDecrement />
 *     </InputGroupAddon>
 *     <NumberInputField />
 *   </InputGroup>
 * </NumberInput>
 * ```
 */
const NumberInputDecrement = React.forwardRef<HTMLButtonElement, NumberInputStepperProps>(
  ({ className, onClick, children, ...props }, ref) => {
    const { decrement, disabled, readOnly, value, min, commitPendingValue } = useNumberInput()

    const handleClick = React.useCallback(
      (e: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(e)
        if (!e.defaultPrevented) {
          // Commit any typed value before decrementing
          commitPendingValue()
          decrement()
        }
      },
      [onClick, commitPendingValue, decrement]
    )

    // Disable button if at min value
    const isDisabled =
      disabled || readOnly || (min !== undefined && value !== undefined && value <= min)

    return (
      <button
        ref={ref}
        type='button'
        onClick={handleClick}
        disabled={isDisabled}
        className={cn(
          'flex items-center justify-center size-5.5 rounded cursor-default',
          'text-muted-foreground hover:text-foreground hover:bg-neutral-200 dark:hover:bg-neutral-800',
          'transition-colors',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          className
        )}
        aria-label='Decrement'
        {...props}>
        {children || <Minus className='size-4' />}
      </button>
    )
  }
)
NumberInputDecrement.displayName = 'NumberInputDecrement'

// ============================================================================
// NumberInputArrows
// ============================================================================

/**
 * NumberInputArrows component - compact vertical stepper with up/down arrows.
 * Place at the end of an InputGroup for native-like number input controls.
 *
 * @example
 * ```tsx
 * <NumberInput value={count} onValueChange={setCount}>
 *   <InputGroup>
 *     <NumberInputField />
 *     <NumberInputArrows />
 *   </InputGroup>
 * </NumberInput>
 * ```
 */
const NumberInputArrows = React.forwardRef<HTMLDivElement, NumberInputArrowsProps>(
  ({ className, ...props }, ref) => {
    /**
     * Prevent mousedown from stealing focus from the input field.
     * Without this, clicking arrows causes: blur (saves old value) → click (increments)
     * which results in the wrong value being saved.
     */
    const preventFocusLoss = (e: React.MouseEvent) => e.preventDefault()

    return (
      <div
        ref={ref}
        className={cn(
          'flex h-full flex-col border-l border-primary-200 overflow-hidden rounded-r-[var(--radius)]',
          className
        )}
        {...props}>
        <NumberInputIncrement
          onMouseDown={preventFocusLoss}
          className={cn(
            // Reset default size-5.5 and rounded
            'size-auto rounded-none',
            // Half height, fixed width
            'h-1/2 w-6',
            // Round top-right corner to match InputGroup
            'rounded-tr-[calc(var(--radius)-5px)]',
            // Separator between buttons
            'border-b border-primary-200'
          )}>
          <ChevronUp className='size-3' />
        </NumberInputIncrement>

        <NumberInputDecrement
          onMouseDown={preventFocusLoss}
          className={cn(
            // Reset default size-5.5 and rounded
            'size-auto rounded-none',
            // Half height, fixed width
            'h-1/2 w-6',
            // Round bottom-right corner to match InputGroup
            'rounded-br-[calc(var(--radius)-5px)]'
          )}>
          <ChevronDown className='size-3' />
        </NumberInputDecrement>
      </div>
    )
  }
)
NumberInputArrows.displayName = 'NumberInputArrows'

// ============================================================================
// Exports
// ============================================================================

export {
  NumberInput,
  NumberInputField,
  NumberInputScrubber,
  NumberInputIncrement,
  NumberInputDecrement,
  NumberInputArrows,
  useNumberInput,
}
