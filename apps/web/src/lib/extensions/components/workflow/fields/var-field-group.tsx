// apps/web/src/lib/extensions/components/workflow/fields/var-field-group.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import type React from 'react'
import { VarEditorField } from '~/components/workflow/ui/input-editor/var-editor'

/**
 * WorkflowVarFieldGroup — container component that maps to VarEditorField.
 *
 * Provides the rounded border, background, and orientation context for grouped fields.
 * Each VarField child inside this group gets a consistent visual treatment.
 */
export const WorkflowVarFieldGroup = ({
  orientation,
  validationError,
  validationType,
  className,
  children,
}: {
  orientation?: 'horizontal' | 'vertical'
  validationError?: string
  validationType?: 'error' | 'warning'
  className?: string
  children: React.ReactNode
}) => {
  return (
    <VarEditorField
      orientation={orientation}
      validationError={validationError}
      validationType={validationType}
      className={cn('p-0', className)}>
      {children}
    </VarEditorField>
  )
}
