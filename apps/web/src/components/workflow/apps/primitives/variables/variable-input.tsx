// apps/web/src/components/workflow/apps/primitives/variables/variable-input.tsx

import { BaseType } from '~/components/workflow/types'
import type { UnifiedVariable } from '~/components/workflow/types/variable-types'
import VariableInputUI from '~/components/workflow/ui/variables/variable-input'

/** App bundles hand us plain strings; keep only the ones that name a real BaseType. */
const BASE_TYPE_VALUES = new Set<string>(Object.values(BaseType))
const toBaseTypes = (types?: string[]): BaseType[] | undefined =>
  types?.filter((type): type is BaseType => BASE_TYPE_VALUES.has(type))

/** Props for VariableInput component */
interface VariableInputProps {
  /** ID of the currently selected variable */
  variableId?: string
  /** ID of the workflow node this input belongs to */
  nodeId: string
  /** Array of allowed variable types (e.g., ['string', 'number']) */
  allowedTypes?: string[]
  /** Placeholder text when no variable is selected */
  placeholder?: string
  /** Whether the input is disabled */
  disabled?: boolean
  /** Additional CSS classes */
  className?: string
  /** Width of the variable selector popover in pixels */
  popoverWidth?: number
  /** Height of the variable selector popover in pixels */
  popoverHeight?: number
  /** Whether to show favorite variables section */
  showFavorites?: boolean
  /** Whether to show recent variables section */
  showRecent?: boolean
  /** Internal instance identifier */
  __instanceId?: string
  /** Internal callback handler */
  __onCallHandler?: (instanceId: string, event: string, ...args: any[]) => Promise<void> | void
  /** Internal flag indicating if onVariableSelect handler exists */
  __hasOnVariableSelect?: boolean
}

/**
 * VariableInput component.
 * Variable selector component for workflow forms.
 */
export const VariableInput = ({
  variableId,
  nodeId,
  allowedTypes,
  placeholder,
  disabled = false,
  className,
  popoverWidth = 420,
  popoverHeight = 600,
  showFavorites = true,
  showRecent = true,
  __instanceId,
  __onCallHandler,
  __hasOnVariableSelect,
}: VariableInputProps) => {
  const handleVariableSelect = async (variable: UnifiedVariable) => {
    if (__onCallHandler && __instanceId && __hasOnVariableSelect) {
      await __onCallHandler(__instanceId, 'onVariableSelect', variable)
    }
  }

  return (
    <VariableInputUI
      variableId={variableId!}
      nodeId={nodeId}
      allowedTypes={toBaseTypes(allowedTypes)}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
      popoverWidth={popoverWidth}
      popoverHeight={popoverHeight}
      showFavorites={showFavorites}
      showRecent={showRecent}
      onVariableSelect={handleVariableSelect}
    />
  )
}
