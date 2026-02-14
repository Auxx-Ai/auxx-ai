// apps/web/src/components/workflow/prompt-editor/prompt-editor-context.tsx

'use client'

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { useAvailableVariables } from '~/components/workflow/hooks'
import type { BaseType, UnifiedVariable, VariableGroup } from '~/components/workflow/types'

// Simple copy utility
const copy = (text: string) => {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text)
  } else {
    // Fallback for older browsers
    const textArea = document.createElement('textarea')
    textArea.value = text
    document.body.appendChild(textArea)
    textArea.select()
    document.execCommand('copy')
    document.body.removeChild(textArea)
  }
}
// Simple useBoolean hook
const useBoolean = (initialValue = false) => {
  const [value, setValue] = useState(initialValue)

  const setTrue = useCallback(() => setValue(true), [])
  const setFalse = useCallback(() => setValue(false), [])
  const toggle = useCallback(() => setValue((v) => !v), [])

  return [value, { setTrue, setFalse, toggle }] as const
}

/** Default minimum height for prompt editor content area */
const DEFAULT_PROMPT_MIN_HEIGHT = 80

/**
 * Main context interface - centralizes all PromptEditor state and configuration
 */
interface PromptEditorContextType {
  // Content Management
  value: string
  onChange: (value: string) => void
  characterCount: number
  setCharacterCount: (count: number) => void

  // Editor State
  isExpanded: boolean
  isFocused: boolean
  isCopied: boolean
  setExpanded: (expanded: boolean) => void
  setFocused: (focused: boolean) => void

  // Height State
  contentHeight: number
  setContentHeight: (height: number) => void
  minHeight: number

  // Configuration
  placeholder?: string
  editable: boolean
  compact?: boolean
  required?: boolean

  // Workflow Integration
  variables: UnifiedVariable[]
  groups: VariableGroup[]
  allVariables: UnifiedVariable[]
  nodeId?: string

  // Event Handlers
  onBlur?: () => void
  onFocus?: () => void
  onRemove?: () => void
  onGenerated?: () => void

  // Operations
  showRemove: boolean
  showAIGenerate: boolean
  handleInsertVariable: () => void
  handleCopy: () => void

  // Editor Integration
  editorRef?: React.MutableRefObject<any>

  // Styling Options
  className?: string
  headerClassName?: string
  inputClassName?: string
  titleClassName?: string
  gradientBorder?: boolean

  // UI Elements
  title?: React.ReactNode
  titleTooltip?: string
}

/**
 * Context for PromptEditor state and configuration
 */
const PromptEditorContext = createContext<PromptEditorContextType | null>(null)

/**
 * Hook to access PromptEditor context with error checking
 */
export const usePromptEditorContext = (): PromptEditorContextType => {
  const context = useContext(PromptEditorContext)
  if (!context) {
    throw new Error('usePromptEditorContext must be used within PromptEditorProvider')
  }
  return context
}

/**
 * Props for PromptEditorProvider - matches existing Editor component interface
 */
interface PromptEditorProviderProps {
  children: React.ReactNode

  // Content
  value?: string
  onChange?: (value: string) => void

  // Configuration
  placeholder?: string
  readOnly?: boolean
  compact?: boolean
  required?: boolean

  // Height Configuration
  height?: number
  minHeight?: number

  // Enhanced Workflow Integration
  nodeId: string // = required
  expectedTypes?: BaseType[] // Optional type filtering
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

  // Styling
  className?: string
  headerClassName?: string
  inputClassName?: string
  titleClassName?: string
  gradientBorder?: boolean

  // UI Elements
  title?: React.ReactNode
  titleTooltip?: string
}

/**
 * Custom hook for expand/collapse functionality
 * Matches the existing useToggleExpend logic
 */
const useToggleExpend = (ref: React.RefObject<HTMLDivElement>) => {
  const [isExpanded, setIsExpanded] = useState(false)

  return { isExpanded, setIsExpanded }
}

/**
 * PromptEditor Provider Component
 * Centralizes all state management and eliminates prop drilling
 */
export const PromptEditorProvider: React.FC<PromptEditorProviderProps> = ({
  children,
  value: initialValue = '',
  onChange: onChangeCallback,
  readOnly = false,
  showRemove = false,
  showAIGenerate = true,
  nodeId,
  expectedTypes,
  includeEnvironment = true,
  includeSystem = true,
  height,
  minHeight = DEFAULT_PROMPT_MIN_HEIGHT,
  // Legacy props (fallback support)
  gradientBorder = true,
  ...props
}) => {
  // Refs
  const ref = useRef<HTMLDivElement>(null)

  // Content state
  const [value, setValue] = useState(initialValue)
  const [isFocused, setIsFocused] = useState(false)
  // UI state using existing patterns
  const [isCopied, setIsCopied] = useState(false)
  // const [isFocus, { setTrue: setFocus, setFalse: setBlur }] = useBoolean(false)

  // Real-time character count for display
  const [characterCount, setCharacterCount] = useState(() => {
    // Initialize with the character count of the initial value
    if (typeof window !== 'undefined') {
      const tempDiv = document.createElement('div')
      tempDiv.innerHTML = initialValue || ''
      return tempDiv.textContent?.length || 0
    }
    return 0
  })

  // Height state for resizable editor
  const [contentHeight, setContentHeight] = useState(height || minHeight)

  // Expand functionality
  const { isExpanded, setIsExpanded } = useToggleExpend(ref)

  // Content change handler
  const handleChange = useCallback(
    (newValue: string) => {
      setValue(newValue)
      onChangeCallback?.(newValue)
    },
    [onChangeCallback]
  )

  // Focus handlers
  const handleFocus = useCallback(() => {
    // setFocus()
    props.onFocus?.()
  }, [props.onFocus])

  const handleBlur = useCallback(() => {
    // setBlur()
    props.onBlur?.()
  }, [props.onBlur])

  // Copy functionality
  const handleCopy = useCallback(() => {
    copy(value)
    setIsCopied(true)
    // Reset copy status after 2 seconds
    setTimeout(() => setIsCopied(false), 2000)
  }, [value])

  // Editor ref for accessing the editor instance
  const editorRef = useRef<any>(null)

  // Variable insertion handler
  const handleInsertVariable = useCallback(() => {
    // setFocus()
    // Insert the trigger character to open variable picker
    if (editorRef.current) {
      editorRef.current
        .chain()
        .focus()
        .command(({ tr }) => {
          tr.insertText('{')
          return true
        })
        .run()
    }
  }, [])
  // Enhanced variable system integration
  // Always call the hook with a fallback nodeId to satisfy hook requirements
  const { variables, groups, allVariables } = useAvailableVariables({
    nodeId,
    expectedTypes,
    includeEnvironment,
    includeSystem,
  })

  // Sync external value changes
  React.useEffect(() => {
    if (initialValue !== value) {
      setValue(initialValue)
    }
  }, [initialValue])

  // Context value with all state and handlers
  const contextValue = useMemo<PromptEditorContextType>(
    () => ({
      nodeId,
      // Content
      value,
      onChange: handleChange,
      characterCount,
      setCharacterCount,

      // State
      isExpanded,
      isFocused,
      isCopied,
      setExpanded: setIsExpanded,
      setFocused: setIsFocused,

      // Height state
      contentHeight,
      setContentHeight,
      minHeight,

      // Configuration
      editable: !readOnly,
      showRemove,
      showAIGenerate,
      gradientBorder,

      // Workflow integration
      variables,
      groups,
      allVariables,

      // Event handlers
      onBlur: handleBlur,
      onFocus: handleFocus,
      onRemove: props.onRemove,
      onGenerated: props.onGenerated,

      // Operations
      handleInsertVariable,
      handleCopy,

      // Editor Integration
      editorRef,
      // Pass through all other props
      ...props,
    }),
    [
      nodeId,
      value,
      handleChange,
      isExpanded,
      // isFocus,
      isCopied,
      setIsExpanded,
      // setFocus,
      readOnly,
      showRemove,
      showAIGenerate,
      gradientBorder,
      variables,
      handleBlur,
      handleFocus,
      handleInsertVariable,
      handleCopy,
      characterCount,
      setCharacterCount,
      contentHeight,
      minHeight,
      props,
    ]
  )

  return (
    <PromptEditorContext.Provider value={contextValue}>{children}</PromptEditorContext.Provider>
  )
}

export default PromptEditorProvider
