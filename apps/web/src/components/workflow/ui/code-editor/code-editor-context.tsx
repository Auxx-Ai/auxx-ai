// apps/web/src/components/workflow/ui/code-editor/code-editor-context.tsx

'use client'

import { useTheme } from 'next-themes'
import type React from 'react'
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { copy } from '~/components/workflow/utils/copy'
import { DEFAULT_MIN_HEIGHT } from './constants'
import type { CodeEditorInput, CodeEditorOutput, CodeEditorProps, CodeLanguage } from './types'

/**
 * Custom hook for expand/collapse functionality
 * Matches the existing useToggleExpend logic from prompt-editor
 */
const useToggleExpand = () => {
  const [isExpanded, setIsExpanded] = useState(false)

  return { isExpanded, setIsExpanded }
}

interface CodeEditorContextType {
  // Props passed through
  value: string
  onChange: (value: string) => void
  language: CodeLanguage
  placeholder?: string
  readOnly?: boolean
  height?: number
  minHeight: number
  title?: React.ReactNode
  headerRight?: React.ReactNode
  tip?: React.ReactNode
  noWrapper?: boolean

  // UI State
  isExpanded: boolean
  setIsExpanded: (expanded: boolean) => void
  isFocused: boolean
  setIsFocused: (focused: boolean) => void
  isCopied: boolean

  // Editor State
  editorRef: React.MutableRefObject<any>
  monacoRef: React.MutableRefObject<any>
  contentHeight: number
  setContentHeight: (height: number) => void

  // Operations
  handleCopy: () => void
  handleFormat: () => void
  handleDownload: () => void

  // Theme
  theme: 'light' | 'vs-dark'

  // Styling
  className?: string
  gradientBorder?: boolean

  // Workflow Integration
  nodeId?: string
  enableWorkflowCompletions?: boolean
  onMount?: (editor: any, monaco: any) => void

  // Download
  downloadFilename?: string

  // Code Generation
  codeInputs?: CodeEditorInput[]
  codeOutputs?: CodeEditorOutput[]
}

const CodeEditorContext = createContext<CodeEditorContextType | undefined>(undefined)

export const useCodeEditorContext = () => {
  const context = useContext(CodeEditorContext)
  if (!context) {
    throw new Error('useCodeEditorContext must be used within a CodeEditorProvider')
  }
  return context
}

interface CodeEditorProviderProps extends CodeEditorProps {
  children: React.ReactNode // Required for provider
}

export const CodeEditorProvider = ({
  children,
  value: initialValue = '',
  onChange: onChangeCallback = () => {},
  language,
  placeholder,
  readOnly = false,
  height,
  minHeight = DEFAULT_MIN_HEIGHT,
  title,
  headerRight,
  tip,
  noWrapper = false,
  className,
  gradientBorder = true,
  isExpand = false,
  isJSONStringifyBeauty = false,
  onMount,
  nodeId,
  enableWorkflowCompletions = true,
  onDownload,
  downloadFilename,
  codeInputs,
  codeOutputs,
}: CodeEditorProviderProps) => {
  // Theme detection
  const { theme: appTheme } = useTheme()
  const theme = useMemo(() => {
    return appTheme === 'light' ? 'light' : 'vs-dark'
  }, [appTheme]) as 'light' | 'vs-dark'

  // State management
  const [isFocused, setIsFocused] = useState(false)
  const [isCopied, setIsCopied] = useState(false)
  const [contentHeight, setContentHeight] = useState(height || minHeight)

  // Refs
  const editorRef = useRef<any>(null)
  const monacoRef = useRef<any>(null)

  // Expand functionality
  const { isExpanded, setIsExpanded } = useToggleExpand()

  // Process value for JSON beautification
  const processedValue = useMemo(() => {
    if (!isJSONStringifyBeauty) return initialValue as string
    try {
      return JSON.stringify(initialValue as object, null, 2)
    } catch {
      return initialValue as string
    }
  }, [initialValue, isJSONStringifyBeauty])

  // Operations
  const handleCopy = useCallback(() => {
    copy(processedValue)
    setIsCopied(true)
    setTimeout(() => {
      setIsCopied(false)
    }, 2000)
  }, [processedValue])

  const handleFormat = useCallback(() => {
    if (!editorRef.current) return

    // Trigger Monaco's format document action
    editorRef.current.getAction('editor.action.formatDocument')?.run()
  }, [])

  const handleDownload = useCallback(() => {
    if (onDownload) {
      onDownload()
      return
    }

    // Auto-download if downloadFilename is provided
    if (downloadFilename) {
      const blob = new Blob([processedValue], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = downloadFilename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }
  }, [onDownload, downloadFilename, processedValue])

  // Context value
  const contextValue = useMemo<CodeEditorContextType>(
    () => ({
      // Props
      value: processedValue,
      onChange: onChangeCallback,
      language,
      placeholder,
      readOnly,
      height,
      minHeight,
      title,
      headerRight,
      tip,
      noWrapper,

      // UI State
      isExpanded: isExpand || isExpanded,
      setIsExpanded,
      isFocused,
      setIsFocused,
      isCopied,

      // Editor State
      editorRef,
      monacoRef,
      contentHeight,
      setContentHeight,

      // Operations
      handleCopy,
      handleFormat,
      handleDownload,

      // Theme
      theme,

      // Styling
      className,
      gradientBorder,

      // Workflow Integration
      nodeId,
      enableWorkflowCompletions,
      onMount,

      // Download
      downloadFilename,

      // Code Generation
      codeInputs,
      codeOutputs,
    }),
    [
      processedValue,
      onChangeCallback,
      language,
      placeholder,
      readOnly,
      height,
      minHeight,
      title,
      headerRight,
      tip,
      noWrapper,
      isExpand,
      isExpanded,
      setIsExpanded,
      isFocused,
      isCopied,
      contentHeight,
      handleCopy,
      handleFormat,
      handleDownload,
      theme,
      className,
      gradientBorder,
      nodeId,
      enableWorkflowCompletions,
      onMount,
      downloadFilename,
      codeInputs,
      codeOutputs,
    ]
  )

  return <CodeEditorContext.Provider value={contextValue}>{children}</CodeEditorContext.Provider>
}

export default CodeEditorProvider
