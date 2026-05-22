// apps/web/src/components/workflow/prompt-editor/editor.tsx

'use client'

import type { TiptapDoc } from '@auxx/lib/tiptap'
import React from 'react'
import type { ReferenceTab } from '~/components/editor/inline-picker/nodes/reference-picker-node'
import { PromptEditorProvider } from './prompt-editor-context'
import PromptEditorWrapper from './prompt-editor-wrapper'

/**
 * Props interface for the new Tiptap-based Editor component.
 *
 * Two content modes:
 *  - **string mode** (default): `value` + `onChange` carry the legacy
 *    `{{variableId}}` text serialization. Used by 9 workflow node panels.
 *  - **JSON mode** (opt-in): `valueJson` + `onChangeJson` carry the full
 *    Tiptap doc. Used by the AI node so `@`-reference chips keep their
 *    `RecordId` attrs (text mode flattens them via `docToText`).
 *
 * The `@`-reference picker is also opt-in (`enableReferencePicker`) so
 * the 9 other node mounts don't get a picker they didn't ask for.
 */
export interface EditorProps {
  // Content
  value?: string
  onChange?: (value: string) => void
  /** JSON-mode content (opt-in — see component docstring). */
  valueJson?: TiptapDoc
  onChangeJson?: (json: TiptapDoc) => void
  /** Mount the `@`-reference picker extensions (opt-in). */
  enableReferencePicker?: boolean
  /** Tabs the reference picker exposes (defaults to `DEFAULT_TABS`). */
  referenceTabs?: ReferenceTab[]

  // Configuration
  placeholder?: string
  readOnly?: boolean
  compact?: boolean
  required?: boolean

  // Workflow Integration
  nodeId: string
  includeEnvironment?: boolean
  includeSystem?: boolean

  // Event Handlers
  onBlur?: () => void
  onFocus?: () => void
  onRemove?: () => void
  onGenerated?: () => void

  // Operations
  showRemove?: boolean
  showAIGenerate?: boolean

  // Height Configuration
  height?: number
  minHeight?: number

  // Variable Picker
  /** Trigger character(s) to open variable picker (default: '{') */
  trigger?: string

  // Styling Options
  className?: string
  headerClassName?: string
  inputClassName?: string
  titleClassName?: string
  gradientBorder?: boolean

  // UI Elements
  title?: React.ReactNode
  titleTooltip?: string

  // Legacy props for compatibility (these will be mapped to new structure)
  editionType?: string
  onEditionTypeChange?: (type: string) => void
  varList?: any[]
  handleAddVariable?: () => void
  modelConfig?: any
}

/**
 *  Tiptap-based Editor Component
 */
const Editor: React.FC<EditorProps> = (props) => {
  return (
    <PromptEditorProvider {...props}>
      <PromptEditorWrapper />
    </PromptEditorProvider>
  )
}

// Export the component with React.memo for performance optimization
export default React.memo(Editor)
