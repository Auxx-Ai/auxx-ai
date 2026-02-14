// apps/web/src/components/workflow/prompt-editor/index.ts

export type { EditorProps } from './editor'
export { default as Editor } from './editor'
export { default as PromptEditorContent } from './prompt-editor-content'
// Context and provider for advanced usage
export { PromptEditorProvider, usePromptEditorContext } from './prompt-editor-context'
// Individual components for custom composition
export { default as PromptEditorHeader } from './prompt-editor-header'
export { default as PromptEditorWrapper } from './prompt-editor-wrapper'
export { default as TiptapPromptEditor } from './tiptap-prompt-editor'
