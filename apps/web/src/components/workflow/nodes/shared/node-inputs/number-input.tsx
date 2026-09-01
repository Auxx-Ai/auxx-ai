// apps/web/src/components/workflow/nodes/shared/node-inputs/number-input.tsx

import { InputGroup, InputGroupAddon } from '@auxx/ui/components/input-group'
import {
  NumberInputArrows,
  NumberInputDecrement,
  NumberInputField,
  NumberInputIncrement,
  NumberInput as NumberInputUi,
} from '@auxx/ui/components/input-number'
import { cn } from '@auxx/ui/lib/utils'
import type { PickerTriggerOptions } from '~/components/ui/picker-trigger'
import { createNodeInput, type NodeInputProps } from './base-node-input'

interface NumberInputProps extends NodeInputProps {
  /** Field name */
  name: string
  /** Placeholder text */
  placeholder?: string
  /** Minimum value */
  min?: number
  /** Maximum value */
  max?: number
  /** Step increment */
  step?: number
  /** Whether to allow decimals */
  allowDecimals?: boolean
  /** Stepper control style: 'buttons' (default +/- buttons) or 'arrows' (compact vertical arrows) */
  stepper?: 'buttons' | 'arrows'
  /** Trigger customization options (className is merged into the input group) */
  triggerProps?: PickerTriggerOptions
}

/**
 * Number input component with validation
 */
export const NumberInput = createNodeInput<NumberInputProps>(
  ({
    inputs,
    errors,
    onChange,
    onError,
    isLoading,
    name,
    placeholder,
    min,
    max,
    step,
    allowDecimals = true,
    stepper = 'arrows',
    triggerProps,
  }) => {
    // Parse value to ensure it's a number, not a string (prevents "3" + 1 = "31" bug)
    const rawValue = inputs[name]
    const value =
      rawValue !== undefined && rawValue !== null && rawValue !== ''
        ? typeof rawValue === 'number'
          ? rawValue
          : parseFloat(String(rawValue))
        : undefined
    const error = errors[name]

    const handleValueChange = (numValue: number | undefined) => {
      // Handle empty or undefined value
      if (numValue === undefined || numValue === null) {
        onError(name, null)
        onChange(name, undefined)
        return
      }

      // Convert to number if it's a string
      const parsedValue =
        typeof numValue === 'string'
          ? allowDecimals
            ? parseFloat(numValue)
            : parseInt(numValue, 10)
          : numValue

      // Validate - use callback instead of mutation
      if (Number.isNaN(parsedValue)) {
        onError(name, 'Please enter a valid number')
        return
      }

      if (min !== undefined && parsedValue < min) {
        onError(name, `Minimum value is ${min}`)
      } else if (max !== undefined && parsedValue > max) {
        onError(name, `Maximum value is ${max}`)
      } else {
        onError(name, null) // Clear error
        onChange(name, parsedValue)
      }
    }

    const inputId = `input-${name}`

    // Return just the input component without wrappers or error displays
    return (
      <NumberInputUi
        value={value}
        onValueChange={handleValueChange}
        min={min}
        step={step}
        disabled={isLoading}>
        <div className={cn('flex flex-col items-start w-full', triggerProps?.className)}>
          <InputGroup
            className={cn(
              'bg-transparent! min-h-8 shadow-none ring-0 border-0 has-[[data-slot=input-group-control]:focus-visible]:ring-[0px]',
              triggerProps?.className
            )}>
            <NumberInputField
              id={inputId}
              placeholder={placeholder}
              className='text-start ps-0 placeholder:text-primary-400'
            />
            {stepper === 'arrows' ? (
              <NumberInputArrows />
            ) : (
              <InputGroupAddon align='inline-end' className='gap-1 pe-1.5'>
                <NumberInputDecrement />
                <NumberInputIncrement />
              </InputGroupAddon>
            )}
          </InputGroup>
        </div>
      </NumberInputUi>
    )
  }
  //   <input

  //   type="number"
  //   value={value}
  //   className="w-full text-sm input-editor-field focus:outline-none focus:ring-0 h-6.5"
  //   onChange={handleChange}
  //   placeholder={placeholder}
  //   disabled={isLoading}
  //   min={min}
  //   max={max}
  //   step={step ?? (allowDecimals ? 'any' : 1)}
  // />
)
