// apps/web/src/components/workflow/prompt-editor/index.ts

export { default as Editor } from './editor'
export type { EditorProps } from './editor'

// Context and provider for advanced usage
export { PromptEditorProvider, usePromptEditorContext } from './prompt-editor-context'

// Individual components for custom composition
export { default as PromptEditorHeader } from './prompt-editor-header'
export { default as PromptEditorContent } from './prompt-editor-content'
export { default as PromptEditorWrapper } from './prompt-editor-wrapper'
export { default as TiptapPromptEditor } from './tiptap-prompt-editor'

// Extensions (DEPRECATED - use useWorkflowVariableEditor from input-editor/hooks instead)
// These exports are kept for backwards compatibility with var-editor.tsx
export {
  WorkflowVariablePickerExtension,
  createWorkflowVariablePickerExtension,
} from './extensions/workflow-variable-picker-extension'
