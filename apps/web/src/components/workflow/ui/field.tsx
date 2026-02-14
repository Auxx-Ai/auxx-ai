// apps/web/src/components/workflow/ui/field.tsx

'use client'

import { Field as BaseField, type FieldProps } from '@auxx/ui/components/section'
import React from 'react'

/**
 * Re-export Field component from packages/ui for backwards compatibility.
 */
function Field(props: FieldProps) {
  return <BaseField {...props} />
}

export default React.memo(Field)
