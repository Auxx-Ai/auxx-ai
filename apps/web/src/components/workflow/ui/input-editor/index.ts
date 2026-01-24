// apps/web/src/components/workflow/ui/input-editor/index.ts

// Main component export
export { default as InputEditor } from './input-editor'
export type { InputEditorProps, TiptapJSON } from './types'

// Core Tiptap component for advanced usage
export { default as TiptapInput } from './tiptap-input'

// New inline-picker based hook (recommended)
export {
  useWorkflowVariableEditor,
  type UseWorkflowVariableEditorOptions,
  type UseWorkflowVariableEditorReturn,
} from './hooks'

// Badge adapter for inline-picker
export { VariableTagBadge } from './variable-tag-badge'

// Legacy hook (DEPRECATED - use useWorkflowVariableEditor instead)
export { useTiptapTags } from './use-tiptap-tags'
