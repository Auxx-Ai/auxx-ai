// apps/web/src/components/workflow/ui/code-editor/index.tsx

'use client'

import React from 'react'
import { CodeEditorProvider } from './code-editor-context'
import CodeEditorWrapper from './code-editor-wrapper'
import type { CodeEditorProps } from './types'

/**
 * Main CodeEditor component
 * Entry point that maintains backward compatibility
 * Wraps children with provider and renders wrapper
 */
function CodeEditor(props: CodeEditorProps) {
  return (
    <CodeEditorProvider {...props}>
      <CodeEditorWrapper />
    </CodeEditorProvider>
  )
}

// Export main component as default
export default React.memo(CodeEditor) as typeof CodeEditor

// Export all sub-components and utilities for custom composition
export { CodeEditor }
export { default as EditorHeightResizeWrap } from '../editor-height-resize-wrap'
export { default as CodeEditorContent } from './code-editor-content'
export { CodeEditorProvider, useCodeEditorContext } from './code-editor-context'
export { default as CodeEditorHeader } from './code-editor-header'
export { default as CodeEditorWrapper } from './code-editor-wrapper'
// Export constants
export * from './constants'
// Export workflow completions utilities
export {
  extractVariableReferences,
  transformWorkflowVariableSyntax,
} from './monaco-workflow-completions'
// Export types
export type { CodeEditorProps } from './types'
export { CodeLanguage, languageMap } from './types'
