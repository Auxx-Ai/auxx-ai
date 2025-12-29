// apps/web/src/components/workflow/nodes/shared/node-inputs/object-input.tsx

import React, { useState } from 'react'
import { Label } from '@auxx/ui/components/label'
import { Textarea } from '@auxx/ui/components/textarea'
import { Button } from '@auxx/ui/components/button'
import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { BookText, ChevronDown, ChevronRight, Code } from 'lucide-react'
import { createNodeInput, type NodeInputProps } from './base-node-input'
import { cn } from '@auxx/ui/lib/utils'
import { StringInput } from './string-input'
import { NumberInput } from './number-input'
import { BooleanInput } from './boolean-input'

// const { StringInput } = require('./string-input')
// const { NumberInput } = require('./number-input')
// const { BooleanInput } = require('./boolean-input')

interface ObjectInputProps extends NodeInputProps {
  /** Field name */
  name: string
  /** Schema fields for structured input */
  fields?: Record<string, { type: string; label?: string; required?: boolean; default?: any }>
  /** Allow raw JSON editing */
  allowRawEdit?: boolean
}

/**
 * Object input component for nested data structures
 */
export const ObjectInput = createNodeInput<ObjectInputProps>(
  ({ inputs, errors, onChange, onError, isLoading, name, fields, allowRawEdit = true }) => {
    const [isRawMode, setIsRawMode] = useState(false)
    const [isCollapsed, setIsCollapsed] = useState(false)
    const [jsonError, setJsonError] = useState<string>()

    const value = inputs[name] || {}
    const error = errors[name]

    const handleRawChange = (rawValue: string) => {
      try {
        const parsed = JSON.parse(rawValue)
        onChange(name, parsed)
        setJsonError(undefined)
      } catch (e) {
        setJsonError('Invalid JSON format')
        // Still update the raw value so user can continue editing
        onChange(`${name}_raw`, rawValue)
      }
    }

    const handleFieldChange = (fieldName: string, fieldValue: any) => {
      onChange(name, { ...value, [fieldName]: fieldValue })
    }

    const inputId = `input-${name}`

    return (
      <div className="w-full">
        <div className=" flex items-center justify-between">
          <span className="text-sm text-primary-400 pointer-events-none">Edit object</span>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setIsCollapsed(!isCollapsed)}>
                {isCollapsed ? <ChevronRight /> : <ChevronDown />}
              </Button>
            </div>

            {allowRawEdit && fields && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setIsRawMode(!isRawMode)}>
                {isRawMode ? <BookText /> : <Code />}
                {isRawMode ? 'Form' : 'JSON'}
              </Button>
            )}
          </div>
        </div>

        {!isCollapsed && (
          <>
            {isRawMode || !fields ? (
              <div className="space-y-2">
                <Textarea
                  id={inputId}
                  value={inputs[`${name}_raw`] || JSON.stringify(value, null, 2)}
                  onChange={(e) => handleRawChange(e.target.value)}
                  placeholder="Enter JSON object"
                  disabled={isLoading}
                  className={cn('font-mono text-sm', jsonError && 'border-destructive')}
                  rows={8}
                />
                {jsonError && (
                  <Alert variant="destructive">
                    <AlertDescription>{jsonError}</AlertDescription>
                  </Alert>
                )}
              </div>
            ) : (
              <div className="space-y-3 pl-6 border-l-2 border-muted">
                {Object.entries(fields).map(([fieldName, field]) => (
                  <FieldInput
                    key={fieldName}
                    name={fieldName}
                    field={field}
                    value={value[fieldName]}
                    onChange={(fieldValue) => handleFieldChange(fieldName, fieldValue)}
                    onError={onError}
                    isLoading={isLoading}
                    error={errors[`${name}.${fieldName}`]}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    )
  }
)

/**
 * Individual field input component
 */
function FieldInput({
  name,
  field,
  value,
  onChange,
  onError,
  isLoading,
  error,
}: {
  name: string
  field: any
  value: any
  onChange: (value: any) => void
  onError: (fieldName: string, error: string | null) => void
  isLoading?: boolean
  error?: string
}) {
  // Import other input components dynamically to avoid circular dependencies

  const commonProps = {
    inputs: { [name]: value ?? field.default },
    errors: error ? { [name]: error } : {},
    onChange: (n: string, v: any) => onChange(v),
    onError: onError,
    isLoading,
    name,
    label: field.label || name,
    required: field.required,
  }

  switch (field.type) {
    case 'string':
      return <StringInput {...commonProps} />
    case 'number':
      return <NumberInput {...commonProps} />
    case 'boolean':
      return <BooleanInput {...commonProps} />
    default:
      return <StringInput {...commonProps} />
  }
}
