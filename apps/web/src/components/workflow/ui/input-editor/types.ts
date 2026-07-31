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
  /**
   * The current value, in the legacy `{{variableId}}` text format —
   * `TiptapInput` drives {@link useWorkflowVariableEditor} in string mode.
   */
  value?: string
  /** Callback fired when value changes (debounced) */
  onChange?: (value: string) => void
  /** Callback fired when editor loses focus */
  onBlur?: (value: string) => void
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

/**
 * A value a {@link VarEditorProps} editor can hold.
 *
 * In variable mode this is always the editor's string content (a variable id or
 * Tiptap text). In constant mode it is the typed constant produced by the
 * per-type input behind `ConstantInputAdapter` — a number for `BaseType.NUMBER`,
 * a boolean for `BaseType.BOOLEAN`, an array for multi-select enums, an object
 * for structured types such as ADDRESS or CURRENCY.
 */
export type VarEditorValue =
  | string
  | number
  | boolean
  | null
  | VarEditorValue[]
  | { [key: string]: VarEditorValue }

export interface VarEditorProps {
  // Core props
  /** The current value - can be plain text, Tiptap JSON string, or Tiptap JSON object */
  value?: VarEditorValue
  /** Callback fired when value changes - now includes isConstantMode */
  onChange?: (value: VarEditorValue, isConstantMode: boolean) => void
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
