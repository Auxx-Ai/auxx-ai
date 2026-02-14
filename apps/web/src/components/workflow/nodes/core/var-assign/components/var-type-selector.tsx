// apps/web/src/components/workflow/nodes/core/var-assign/components/var-type-selector.tsx

'use client'

import type React from 'react'
import { useMemo } from 'react'
import { BaseType } from '~/components/workflow/types/unified-types'
import {
  VariableTypePicker,
  type VariableTypeValue,
} from '~/components/workflow/ui/variable-type-picker'

interface VarTypeSelectorProps {
  value: BaseType
  isArray?: boolean
  onChange: (type: BaseType, isArray: boolean) => void
  disabled?: boolean
  className?: string
}

/**
 * Variable type selector component
 * Supports typed arrays via separate isArray flag
 */
export const VarTypeSelector: React.FC<VarTypeSelectorProps> = ({
  value,
  isArray = false,
  onChange,
  disabled,
  className,
}) => {
  // Convert BaseType + isArray to VariableTypeValue
  const typeValue: VariableTypeValue = useMemo(() => {
    return {
      baseType: value,
      isArray,
    }
  }, [value, isArray])

  // Convert VariableTypeValue back to BaseType + isArray
  const handleChange = (newValue: VariableTypeValue) => {
    onChange(newValue.baseType, newValue.isArray)
  }

  return (
    <VariableTypePicker
      value={typeValue}
      onChange={handleChange}
      disabled={disabled}
      className={className}
      compact
      includeArrayToggle={true}
      excludeTypes={[
        BaseType.TIME,
        BaseType.REFERENCE,
        BaseType.EMAIL,
        BaseType.URL,
        BaseType.PHONE,
        BaseType.ENUM,
        BaseType.JSON,
        BaseType.RELATION,
        BaseType.FILE,
        BaseType.ARRAY,
        BaseType.ANY,
        BaseType.NULL,
      ]}
    />
  )
}
