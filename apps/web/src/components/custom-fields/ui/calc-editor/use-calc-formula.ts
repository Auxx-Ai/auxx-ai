// apps/web/src/components/custom-fields/ui/calc-editor/use-calc-formula.ts
'use client'

import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { FieldNode } from './field-node'
import { createFieldPickerExtension } from './field-picker-extension'
import { formulaToString, stringToFormula, extractFieldKeys } from './formula-converters'
import { validateCalcExpression } from '@auxx/utils/calc-expression'

/** Options for the useCalcFormula hook */
export interface UseCalcFormulaOptions {
  /** Initial expression string */
  initialExpression?: string
  /** Callback when expression changes */
  onExpressionChange?: (expression: string, sourceFields: string[]) => void
  /** Available fields that can be referenced in the expression */
  availableFields: Array<{ key: string; label: string; type: string }>
  /** Placeholder text for empty editor */
  placeholder?: string
}

/**
 * Hook for managing the CALC formula TipTap editor state.
 * Handles expression parsing, validation, and conversion.
 */
export function useCalcFormula({
  initialExpression = '',
  onExpressionChange,
  availableFields,
  placeholder = 'Type { to insert a field or function...',
}: UseCalcFormulaOptions) {
  const [expression, setExpression] = useState(initialExpression)
  const contentRef = useRef(initialExpression)
  const onChangeRef = useRef(onExpressionChange)

  // Update ref when callback changes
  useEffect(() => {
    onChangeRef.current = onExpressionChange
  }, [onExpressionChange])

  // Convert initial expression to TipTap content
  const initialContent = useMemo(() => {
    return stringToFormula(initialExpression)
  }, [initialExpression])

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
        createFieldPickerExtension(availableFields),
        Placeholder.configure({
          placeholder,
          showOnlyWhenEditable: true,
        }),
      ],
      content: initialContent,
      onUpdate: ({ editor }: { editor: any }) => {
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
    [initialContent, availableFields, placeholder]
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

  return {
    editor,
    expression,
    validation,
    missingFields,
    sourceFields: validation.extractedFields,
    setContent,
  }
}
