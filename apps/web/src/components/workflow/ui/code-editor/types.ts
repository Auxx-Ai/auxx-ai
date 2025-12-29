// apps/web/src/components/workflow/ui/code-editor/types.ts

import type React from 'react'

export enum CodeLanguage {
  javascript = 'javascript',
  json = 'json',
}

export const languageMap: Record<CodeLanguage, string> = {
  [CodeLanguage.javascript]: 'javascript',
  [CodeLanguage.json]: 'json',
}

/** Input variable for code generation */
export interface CodeEditorInput {
  name: string
  description?: string
}

/** Output variable for code generation */
export interface CodeEditorOutput {
  name: string
  type: string
  description?: string
}

export interface CodeEditorProps {
  // Content
  value?: string | object
  onChange?: (value: string) => void
  children?: React.ReactNode

  // Language Configuration
  language: CodeLanguage
  isJSONStringifyBeauty?: boolean

  // UI Configuration
  title?: string | React.ReactNode
  placeholder?: string
  headerRight?: React.ReactNode
  readOnly?: boolean
  height?: number
  minHeight?: number

  // Monaco Configuration
  onMount?: (editor: any, monaco: any) => void

  // Styling
  className?: string
  noWrapper?: boolean
  isExpand?: boolean
  tip?: React.ReactNode
  gradientBorder?: boolean

  // Theme
  theme?: 'light' | 'vs-dark'

  // Workflow Integration
  nodeId?: string
  enableWorkflowCompletions?: boolean

  // Download Configuration
  onDownload?: () => void
  downloadFilename?: string

  // Code Generation Configuration
  codeInputs?: CodeEditorInput[]
  codeOutputs?: CodeEditorOutput[]
}
