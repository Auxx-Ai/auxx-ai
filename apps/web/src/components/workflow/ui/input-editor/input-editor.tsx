// apps/web/src/components/workflow/ui/input-editor/input-editor.tsx

'use client'

import React from 'react'
import TiptapInput from './tiptap-input'
import type { InputEditorProps } from './types'

/**
 * InputEditor Component
 *
 * A simplified single-line text input with variable support.
 * Uses Tiptap editor under the hood but presents a standard input field appearance.
 *
 * Features:
 * - Single '{' trigger for variable insertion
 * - Variable nodes rendered as styled tags
 * - Single-line constraint (Enter key blurs the input)
 * - Standard input field styling
 * - Preserves variables in JSON format
 *
 * @example
 * ```tsx
 * <InputEditor
 *   value={config.someField}
 *   onChange={(value) => {
 *     handleConfigChange({
 *       ...config,
 *       someField: text,
 *       someFieldEditorContent: value
 *     })
 *   }}
 *   placeholder="Enter value or use {variables}..."
 *   nodeId={nodeId}
 *   disabled={isReadOnly}
 * />
 * ```
 */
const InputEditor: React.FC<InputEditorProps> = (props) => {
  return <TiptapInput {...props} />
}

// Export with React.memo for performance optimization
export default React.memo(InputEditor)
