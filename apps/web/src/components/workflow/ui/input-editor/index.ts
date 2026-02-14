// apps/web/src/components/workflow/ui/input-editor/index.ts

// New inline-picker based hook (recommended)
export {
  type UseWorkflowVariableEditorOptions,
  type UseWorkflowVariableEditorReturn,
  useWorkflowVariableEditor,
} from './hooks'
// Main component export
export { default as InputEditor } from './input-editor'

// Core Tiptap component for advanced usage
export { default as TiptapInput } from './tiptap-input'
export type { InputEditorProps, TiptapJSON } from './types'

// Badge adapter for inline-picker
export { VariableTagBadge } from './variable-tag-badge'
