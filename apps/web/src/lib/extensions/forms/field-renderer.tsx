// apps/web/src/lib/extensions/forms/field-renderer.tsx

'use client'

import React from 'react'
import { useFormContext } from 'react-hook-form'
import { Input } from '@auxx/ui/components/input'
import { Textarea } from '@auxx/ui/components/textarea'
import { Checkbox } from '@auxx/ui/components/checkbox'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@auxx/ui/components/select'
import { Label } from '@auxx/ui/components/label'
import type { SerializedFormValue } from './types'

interface FieldRendererProps {
  name: string
  label: string
  placeholder?: string
  description?: string
  disabled?: boolean
  fieldSchema: SerializedFormValue
}

/**
 * Renders the appropriate input component based on field type.
 * Includes full accessibility support (ARIA attributes).
 */
export const FieldRenderer = React.memo(function FieldRenderer({
  name,
  label,
  placeholder,
  description,
  disabled = false,
  fieldSchema,
}: FieldRendererProps) {
  const {
    register,
    formState: { errors },
    watch,
    setValue,
  } = useFormContext()

  const error = errors[name]?.message as string | undefined
  const isOptional = 'optional' in fieldSchema.metadata ? fieldSchema.metadata.optional ?? false : false

  // Use placeholder from props or fallback to schema
  const effectivePlaceholder =
    placeholder ||
    ('placeholder' in fieldSchema.metadata ? fieldSchema.metadata.placeholder : undefined)

  // Generate IDs for accessibility
  const fieldId = `form-field-${name}`
  const errorId = `${fieldId}-error`
  const descriptionId = `${fieldId}-description`

  switch (fieldSchema.type) {
    case 'string': {
      const isMultiline = fieldSchema.metadata.multiline ?? false
      const inputType = fieldSchema.metadata.email
        ? 'email'
        : fieldSchema.metadata.url
          ? 'url'
          : 'text'

      return (
        <div className="space-y-2">
          <Label htmlFor={fieldId}>
            {label}
            {!isOptional && <span className="text-destructive ml-1">*</span>}
          </Label>

          {isMultiline ? (
            <Textarea
              id={fieldId}
              placeholder={effectivePlaceholder}
              disabled={disabled}
              aria-invalid={!!error}
              aria-describedby={
                error ? errorId : description ? descriptionId : undefined
              }
              {...register(name)}
            />
          ) : (
            <Input
              id={fieldId}
              type={inputType}
              placeholder={effectivePlaceholder}
              disabled={disabled}
              aria-invalid={!!error}
              aria-describedby={
                error ? errorId : description ? descriptionId : undefined
              }
              {...register(name)}
            />
          )}

          {description && (
            <p id={descriptionId} className="text-sm text-muted-foreground">
              {description}
            </p>
          )}

          {error && (
            <p id={errorId} role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      )
    }

    case 'number': {
      return (
        <div className="space-y-2">
          <Label htmlFor={fieldId}>
            {label}
            {!isOptional && <span className="text-destructive ml-1">*</span>}
          </Label>

          <Input
            id={fieldId}
            type="number"
            placeholder={effectivePlaceholder}
            disabled={disabled}
            aria-invalid={!!error}
            aria-describedby={
              error ? errorId : description ? descriptionId : undefined
            }
            step={fieldSchema.metadata.integer ? '1' : 'any'}
            {...register(name, { valueAsNumber: true })}
          />

          {description && (
            <p id={descriptionId} className="text-sm text-muted-foreground">
              {description}
            </p>
          )}

          {error && (
            <p id={errorId} role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      )
    }

    case 'boolean': {
      const value = watch(name)

      return (
        <div className="space-y-2">
          <div className="flex items-center space-x-2">
            <Checkbox
              id={fieldId}
              checked={value}
              disabled={disabled}
              onCheckedChange={(checked) => setValue(name, checked)}
              aria-invalid={!!error}
              aria-describedby={error ? errorId : undefined}
            />
            <Label htmlFor={fieldId} className="cursor-pointer">
              {label}
            </Label>
          </div>

          {description && (
            <p id={descriptionId} className="text-sm text-muted-foreground">
              {description}
            </p>
          )}

          {error && (
            <p id={errorId} role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      )
    }

    case 'select': {
      const options = fieldSchema.metadata.options as Array<{
        value: string
        label: string
        disabled?: boolean
      }>
      const value = watch(name)

      return (
        <div className="space-y-2">
          <Label htmlFor={fieldId}>
            {label}
            {!isOptional && <span className="text-destructive ml-1">*</span>}
          </Label>

          <Select
            value={value}
            onValueChange={(val) => setValue(name, val)}
            disabled={disabled}>
            <SelectTrigger
              id={fieldId}
              aria-invalid={!!error}
              aria-describedby={
                error ? errorId : description ? descriptionId : undefined
              }>
              <SelectValue
                placeholder={effectivePlaceholder || 'Select an option'}
              />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {description && (
            <p id={descriptionId} className="text-sm text-muted-foreground">
              {description}
            </p>
          )}

          {error && (
            <p id={errorId} role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      )
    }

    default:
      return null
  }
})
