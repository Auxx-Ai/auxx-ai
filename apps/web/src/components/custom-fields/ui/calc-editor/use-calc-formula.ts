// apps/web/src/components/custom-fields/ui/calc-editor/use-calc-formula.ts
'use client'

import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { FieldNode } from './field-node'
import { createFieldPickerExtension, type SuggestionState } from './field-picker-extension'
import { formulaToString, stringToFormula, extractFieldKeys } from './formula-converters'
import { validateCalcExpression } from '@auxx/utils/calc-expression'

/** Options for the useCalcFormula hook */
export interface UseCalcFormulaOptions {
  /** Initial expression string */
  initialExpression?: string
  /** Callback when expression changes */
  onExpressionChange?: (expression: string, sourceFields: string[]) => void
  /** Entity definition ID for field picker */
  entityDefinitionId: string
  /** Current field ID to exclude from picker (prevent self-reference) */
  currentFieldId?: string
  /** Available fields for display and validation */
  availableFields: Array<{ key: string; label: string; type: string }>
  /** Placeholder text for empty editor */
  placeholder?: string
}

/** Initial closed state for suggestion */
const initialSuggestionState: SuggestionState = {
  isOpen: false,
  query: '',
  range: null,
  clientRect: null,
}

/**
 * Hook for managing the CALC formula TipTap editor state.
 * Handles expression parsing, validation, and conversion.
 */
export function useCalcFormula({
  initialExpression = '',
  onExpressionChange,
  entityDefinitionId,
  currentFieldId,
  availableFields,
  placeholder = 'Type { to insert a field or function...',
}: UseCalcFormulaOptions) {
  const [expression, setExpression] = useState(initialExpression)
  const [suggestionState, setSuggestionState] = useState<SuggestionState>(initialSuggestionState)
  const contentRef = useRef(initialExpression)
  const onChangeRef = useRef(onExpressionChange)
  const suggestionRangeRef = useRef<{ from: number; to: number } | null>(null)

  // Update ref when callback changes
  useEffect(() => {
    onChangeRef.current = onExpressionChange
  }, [onExpressionChange])

  // Track suggestion range for insertion
  useEffect(() => {
    suggestionRangeRef.current = suggestionState.range
  }, [suggestionState.range])

  // Convert initial expression to TipTap content
  const initialContent = useMemo(() => {
    return stringToFormula(initialExpression)
  }, [initialExpression])

  // Memoize onStateChange callback
  const handleSuggestionStateChange = useCallback((state: SuggestionState) => {
    setSuggestionState(state)
  }, [])

  // Build editor configuration
  const editorConfig = useMemo(
    () => ({
      extensions: [
        StarterKit.configure({
          heading: false,
          blockquote: false,
          bulletList: false,
          orderedList: false,
          listItem: false,
          codeBlock: false,
          horizontalRule: false,
        }),
        FieldNode,
        createFieldPickerExtension({
          entityDefinitionId,
          currentFieldId,
          onStateChange: handleSuggestionStateChange,
        }),
        Placeholder.configure({
          placeholder,
          showOnlyWhenEditable: true,
        }),
      ],
      content: initialContent,
      onUpdate: ({ editor }: { editor: Editor }) => {
        const json = editor.getJSON()
        const newExpression = formulaToString(json)
        const sourceFields = extractFieldKeys(json)

        if (newExpression !== contentRef.current) {
          contentRef.current = newExpression
          setExpression(newExpression)
          onChangeRef.current?.(newExpression, sourceFields)
        }
      },
      editorProps: {
        attributes: {
          class: 'formula-editor-content font-mono text-sm min-h-[60px] p-2 focus:outline-none',
        },
      },
      immediatelyRender: false,
      shouldRerenderOnTransaction: false,
    }),
    [initialContent, entityDefinitionId, currentFieldId, placeholder, handleSuggestionStateChange]
  )

  const editor = useEditor(editorConfig)

  // Store available fields in editor storage for FieldNodeView
  useEffect(() => {
    if (editor) {
      editor.storage.availableFields = availableFields
    }
  }, [editor, availableFields])

  // Validation result
  const validation = useMemo(() => {
    if (!expression.trim()) {
      return { isValid: false, extractedFields: [] as string[], error: 'Expression is required' }
    }
    return validateCalcExpression(expression)
  }, [expression])

  // Check for missing fields
  const missingFields = useMemo(() => {
    const availableKeys = new Set(availableFields.map((f) => f.key))
    return validation.extractedFields.filter((f) => !availableKeys.has(f))
  }, [validation.extractedFields, availableFields])

  // Set content programmatically
  const setContent = useCallback(
    (newExpression: string) => {
      if (editor && newExpression !== expression) {
        const tiptapContent = stringToFormula(newExpression)
        editor.commands.setContent(tiptapContent)
        contentRef.current = newExpression
        setExpression(newExpression)
      }
    },
    [editor, expression]
  )

  /** Insert a field node at the suggestion trigger position */
  const insertField = useCallback(
    (fieldKey: string) => {
      if (!editor || !suggestionRangeRef.current) return

      const range = suggestionRangeRef.current
      // Clear the ref immediately to prevent closeSuggestion from deleting again
      suggestionRangeRef.current = null

      editor
        .chain()
        .focus()
        .deleteRange({ from: range.from, to: range.to })
        .insertContent({
          type: 'field-node',
          attrs: { fieldKey },
        })
        .run()

      // Close the suggestion
      setSuggestionState(initialSuggestionState)
    },
    [editor]
  )

  /** Insert a function name at the suggestion trigger position */
  const insertFunction = useCallback(
    (funcName: string) => {
      if (!editor || !suggestionRangeRef.current) return

      const range = suggestionRangeRef.current
      // Clear the ref immediately to prevent closeSuggestion from deleting again
      suggestionRangeRef.current = null

      editor
        .chain()
        .focus()
        .deleteRange({ from: range.from, to: range.to })
        .insertContent(`${funcName}(`)
        .run()

      // Close the suggestion
      setSuggestionState(initialSuggestionState)
    },
    [editor]
  )

  /** Close the suggestion picker and remove the trigger character */
  const closeSuggestion = useCallback(() => {
    // Delete the trigger character and any query text
    if (editor && suggestionRangeRef.current) {
      const range = suggestionRangeRef.current
      suggestionRangeRef.current = null
      editor.chain().focus().deleteRange({ from: range.from, to: range.to }).run()
    }
    setSuggestionState(initialSuggestionState)
    editor?.commands.focus()
  }, [editor])

  return {
    editor,
    expression,
    validation,
    missingFields,
    sourceFields: validation.extractedFields,
    setContent,
    // Suggestion state and actions for external picker UI
    suggestionState,
    insertField,
    insertFunction,
    closeSuggestion,
  }
}
