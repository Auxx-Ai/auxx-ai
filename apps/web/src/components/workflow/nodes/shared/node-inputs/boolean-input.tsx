// apps/web/src/components/workflow/nodes/shared/node-inputs/boolean-input.tsx

import { Button } from '@auxx/ui/components/button'
import { ButtonGroup } from '@auxx/ui/components/button-group'
import { Switch } from '@auxx/ui/components/switch'
import { createNodeInput, type NodeInputProps } from './base-node-input'

interface BooleanInputProps extends NodeInputProps {
  /** Field name */
  name: string
  /** Default value - supports tri-state: true, false, or null (no selection) */
  defaultValue?: boolean | null
  /** Label for the true button */
  trueLabel?: string
  /** Label for the false button */
  falseLabel?: string
  /** Variant: 'button-group' (default, tri-state) or 'switch' (binary) */
  variant?: 'button-group' | 'switch'
  /** Label shown next to the switch (only for switch variant) */
  label?: string
}

/**
 * Boolean input component with two variants:
 * - 'button-group' (default): ButtonGroup with toggle-off capability, supports tri-state (true, false, null)
 * - 'switch': Binary switch component (true or false only)
 */
export const BooleanInput = createNodeInput<BooleanInputProps>(
  ({
    inputs,
    errors,
    onChange,
    onError,
    isLoading,
    name,
    defaultValue = null,
    trueLabel = 'True',
    falseLabel = 'False',
    variant = 'button-group',
    label,
  }) => {
    const value = inputs[name] ?? defaultValue
    const error = errors[name]

    /** Handler for switch variant */
    const handleSwitchChange = (checked: boolean) => {
      onChange(name, checked)
      if (error) {
        onError(name, null)
      }
    }

    /** Handler for button-group variant */
    const handleButtonGroupChange = (indices: number[]) => {
      // Map ButtonGroup indices back to boolean value
      // [0] -> true, [1] -> false, [] -> null
      let newValue: boolean | null = null
      if (indices.includes(0)) {
        newValue = true
      } else if (indices.includes(1)) {
        newValue = false
      }
      onChange(name, newValue)
      if (error) {
        onError(name, null)
      }
    }

    // Switch variant: binary toggle
    if (variant === 'switch') {
      return (
        <div className='flex items-center h-8 gap-2'>
          <Switch
            checked={value === true}
            onCheckedChange={handleSwitchChange}
            disabled={isLoading}
            size='sm'
          />
          {label && <span className='text-sm text-foreground-muted'>{label}</span>}
        </div>
      )
    }

    // Button-group variant (default): tri-state toggle
    // Map boolean value to ButtonGroup indices: true -> [0], false -> [1], null/undefined -> []
    const selectedIndices = value === true ? [0] : value === false ? [1] : []

    return (
      <div className='flex items-center h-8'>
        <ButtonGroup
          mode='toggle'
          toggleMode='single'
          isPill={true}
          value={selectedIndices}
          onChange={handleButtonGroupChange}
          className='w-full'>
          <Button
            variant='transparent'
            size='xs'
            disabled={isLoading}
            className='aria-checked:inset-shadow-black/20 rounded-full aria-checked:bg-info aria-checked:to-info aria-checked:from-info aria-checked:text-white duration-0'>
            {trueLabel}
          </Button>
          <Button
            variant='transparent'
            size='xs'
            disabled={isLoading}
            className='aria-checked:inset-shadow-black/20 rounded-full aria-checked:bg-info aria-checked:to-info aria-checked:from-info aria-checked:text-white duration-0'>
            {falseLabel}
          </Button>
        </ButtonGroup>
      </div>
    )
  }
)
