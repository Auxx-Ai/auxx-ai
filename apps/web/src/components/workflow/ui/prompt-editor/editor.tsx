// apps/web/src/components/workflow/prompt-editor/editor.tsx

'use client'

import React from 'react'
import { PromptEditorProvider } from './prompt-editor-context'
import PromptEditorWrapper from './prompt-editor-wrapper'

/**
 * Props interface for the new Tiptap-based Editor component
 */
export interface EditorProps {
  // Content
  value?: string
  onChange?: (value: string) => void

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
