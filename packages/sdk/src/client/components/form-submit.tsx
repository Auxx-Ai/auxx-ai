// packages/sdk/src/client/components/form-submit.tsx

import React from 'react'

export interface FormSubmitProps {
  /** Button label */
  children: string

  /** Button variant */
  variant?: 'default' | 'outline' | 'destructive' | 'secondary' | 'ghost'

  /** Loading text */
  loadingText?: string

  /** Whether button is disabled */
  disabled?: boolean

  /** Component identifier (internal) */
  component?: 'FormSubmit'
}

/**
 * Form submit button.
 * Automatically handles loading state during submission.
 *
 * @example
 * <FormSubmit>Save Changes</FormSubmit>
 * <FormSubmit loadingText="Saving..." variant="default">Submit</FormSubmit>
 */
export const FormSubmit: React.FC<FormSubmitProps> = (props) =>
  React.createElement('auxxformsubmit', {
    ...props,
    component: 'FormSubmit',
  })
