// packages/sdk/src/client/components/form-field.tsx

import React from 'react'

export interface FormFieldProps {
  /** Field name (must match schema key) */
  name: string

  /** Field label */
  label: string

  /** Placeholder text (overrides schema placeholder) */
  placeholder?: string

  /** Description/help text */
  description?: string

  /** Whether field is disabled */
  disabled?: boolean

  /** Component identifier (internal) */
  component?: 'FormField'
}

/**
 * Individual form field component.
 * The actual input type is determined by the schema definition.
 *
 * @example
 * <FormField name="email" label="Email" placeholder="you@example.com" />
 * <FormField
 *   name="bio"
 *   label="Biography"
 *   description="Tell us about yourself"
 * />
 */
export const FormField: React.FC<FormFieldProps> = (props) =>
  React.createElement('auxxformfield', {
    ...props,
    component: 'FormField',
  })
