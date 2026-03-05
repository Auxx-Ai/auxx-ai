// apps/web/src/components/workflow/ui/input-editor/types.ts

import type { BaseType, VarMode } from '~/components/workflow/types'
import type { FieldOptions } from './get-input-component'

/**
 * Tiptap JSON content structure
 */
export interface TiptapJSON {
  type: 'doc'
  content?: Array<{ type: string; content?: any[]; attrs?: any; text?: string }>
}

/**
 * Props for the InputEditor component
 * A simplified single-line text input with variable support
 */
export interface InputEditorProps {
  // Core props
  /** The current value - can be plain text, Tiptap JSON string, or Tiptap JSON object */
  value?: string | TiptapJSON
  /** Callback fired when value changes (on every keystroke) - now returns JSON object */
  onChange?: (value: TiptapJSON) => void
  /** Callback fired when editor loses focus - now returns JSON object */
  onBlur?: (value: TiptapJSON) => void
  /** Placeholder text when empty */
  placeholder?: string
  /** Whether the input is disabled */
  disabled?: boolean
  /** Whether the input is read-only */
  readOnly?: boolean

  // Variable support
  /** Available variables for variable picker */
  // availableVariables?: UnifiedVariable[]
  /** Variable groups for organized display */
  // variableGroups?: VariableGroup[]
  /** All variables (flattened) for search */
  // allVariables?: UnifiedVariable[]
  /** Node ID for context */
  nodeId: string

  expectedTypes?: BaseType[]

  // Events
  /** Callback fired when editor gains focus */
  onFocus?: () => void

  // Styling
  /** Additional CSS classes for the wrapper */
  className?: string

  // Accessibility
  /** Tab index for keyboard navigation */
  tabIndex?: number
}

/**
 * Internal state for the input editor
 */
export interface InputEditorState {
  /** Whether the editor is currently focused */
  isFocused: boolean
  /** The latest content for blur handling */
  latestContent: string
}

export type VarEditorType = 'text' | 'json' | 'html' | 'markdown' | 'code'
export interface VarEditorProps {
  // Core props
  /** The current value - can be plain text, Tiptap JSON string, or Tiptap JSON object */
  value?: string
  /** Callback fired when value changes - now includes isConstantMode */
  onChange?: (value: string, isConstantMode: boolean) => void
  /** Callback fired when editor loses focus - now returns JSON object */
  onBlur?: (value: string) => void
  /** Placeholder text when empty */
  placeholder?: string
  placeholderConstant?: string
  /** Whether the input is disabled */
  disabled?: boolean
  /** Whether the input is read-only */
  readOnly?: boolean
  allowConstant?: boolean
  /** Whether variable mode is available. When false, hides toggle and forces constant mode. Default: true */
  allowVariable?: boolean

  // Constant mode control
  /** External control of constant mode */
  isConstantMode?: boolean
  /** Callback when mode changes */
  onConstantModeChange?: (isConstant: boolean) => void
  /** Initial state if not controlled */
  defaultIsConstantMode?: boolean

  // Variable support
  /** Available variables for variable picker */
  nodeId: string

  // Events
  /** Callback fired when editor gains focus */
  onFocus?: () => void

  // Styling
  /** Additional CSS classes for the wrapper */
  className?: string
  varType?: BaseType
  itemType?: BaseType
  /** Full field.options object for type-specific config (enum via fieldOptions.enum, fieldReference via fieldOptions.fieldReference) */
  fieldOptions?: FieldOptions

  // Type filtering
  /** Allowed types for variable selection (can include BaseType or TableId for relationships) */
  allowedTypes?: BaseType[]

  // Editor mode
  /** Editor mode - 'rich' for tiptap editor, 'picker' for single variable selection */
  mode?: VarMode

  // UI options
  /** Hide the clear content button (default: false) */
  hideClearButton?: boolean
}
export interface VarEditorState {
  /** Whether the editor is currently focused */
  isFocused: boolean
  /** The latest content for blur handling */
  latestContent: string
}
