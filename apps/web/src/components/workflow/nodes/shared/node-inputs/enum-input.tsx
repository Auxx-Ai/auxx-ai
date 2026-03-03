// apps/web/src/components/workflow/nodes/shared/node-inputs/enum-input.tsx

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { createNodeInput, type NodeInputProps } from './base-node-input'

interface EnumOption {
  value: string
  label: string
  description?: string
}

interface EnumInputProps extends NodeInputProps {
  /** Field name */
  name: string
  /** Enum options - can be string array or option objects */
  options: string[] | EnumOption[]
  /** Placeholder text */
  placeholder?: string
  /** Default value */
  defaultValue?: string
  /** SelectTrigger variant override */
  selectVariant?: 'transparent' | 'outline'
}

/**
 * Enum/Select input component
 */
export const EnumInput = createNodeInput<EnumInputProps>(
  ({
    inputs,
    errors,
    onChange,
    onError,
    isLoading,
    name,
    options,
    placeholder,
    defaultValue,
    selectVariant,
  }) => {
    const value = (inputs?.[name] as string | undefined) ?? defaultValue ?? ''
    const error = errors?.[name]

    const handleChange = (newValue: string) => {
      onChange(name, newValue)
      // Clear any errors - use callback instead of mutation
      if (error) {
        onError(name, null)
      }
    }

    const inputId = `input-${name}`

    // Normalize options to EnumOption format and filter out empty values
    // (Radix Select reserves empty string for "no selection" state)
    const normalizedOptions: EnumOption[] = options
      .map((opt) => (typeof opt === 'string' ? { value: opt, label: opt } : opt))
      .filter((opt) => opt.value !== '')
    const placeholderText = placeholder || 'Select an option'
    // Return just the Select component without wrappers or error displays
    return (
      <Select value={value} onValueChange={handleChange} disabled={isLoading}>
        <SelectTrigger
          id={inputId}
          size={selectVariant === 'outline' ? 'xs' : 'sm'}
          variant={selectVariant ?? 'transparent'}
          className={selectVariant === 'outline' ? 'mt-1' : 'ps-0 pe-1 min-h-8'}>
          <SelectValue
            placeholder={
              <span className='text-primary-400 font-normal text-sm pointer-events-none'>
                {placeholderText}
              </span>
            }
          />
        </SelectTrigger>
        <SelectContent>
          {normalizedOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <div className='flex flex-col'>
                <span>{option.label}</span>
                {option.description && (
                  <span className='text-xs text-muted-foreground'>{option.description}</span>
                )}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
)
