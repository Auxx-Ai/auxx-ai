// apps/web/src/components/custom-fields/ui/calc-editor/use-calc-formula.tsx

'use client'

import { validateCalcExpression } from '@auxx/utils/calc-expression'
import Placeholder from '@tiptap/extension-placeholder'
import { type Editor, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createInlineNode,
  getOpenPickerRange,
  ReferencePickerNode,
} from '~/components/editor/inline-picker'
import { FieldBadge } from '~/components/resources/ui'
import { extractFieldIds, formulaToString, stringToFormula } from './formula-converters'

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

/**
 * Hook for managing the CALC formula TipTap editor state.
 * Handles expression parsing, validation, and conversion.
 *
 * The `{`-triggered field/function picker rides on the shared
 * `ReferencePickerNode` chip (the same primitive used by the snippet /
 * greeting editors): typing `{` opens an inert chip and the consumer mounts
 * the picker popover via `useActivePicker` + `InlinePickerPopover`. Selection
 * is committed here through `getOpenPickerRange` — fields collapse to a
 * `field` badge node, functions insert their literal `name(` text.
 */
export function useCalcFormula({
  initialExpression = '',
  onExpressionChange,
  entityDefinitionId,
  availableFields,
  placeholder = 'Type { to insert a field or function...',
}: UseCalcFormulaOptions) {
  const [expression, setExpression] = useState(initialExpression)
  const contentRef = useRef(initialExpression)
  const onChangeRef = useRef(onExpressionChange)

  useEffect(() => {
    onChangeRef.current = onExpressionChange
  }, [onExpressionChange])

  // Convert initial expression to TipTap content
  const initialContent = useMemo(() => stringToFormula(initialExpression), [initialExpression])

  // Create field node with base factory — serializes to `{id}`.
  const fieldNode = useMemo(
    () =>
      createInlineNode(
        {
          type: 'field',
          serialize: (id) => `{${id}}`,
          pastePattern: {
            pattern: /\{([^{}]+)\}/,
            getId: (match) => match[1]!,
          },
          inputRules: [{ find: /\{([\w-]+)\}$/, getId: (match) => match[1]! }],
        },
        ({ id, selected }) => (
          <FieldBadge id={id} entityDefinitionId={entityDefinitionId} selected={selected} />
        )
      ),
    [entityDefinitionId]
  )

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
        fieldNode,
        // `{` fires mid-word (allowedPrefixes: null) — formula authors type
        // `concat({first}, {last})` where `{` directly follows `(` or `,`.
        ReferencePickerNode.configure({
          triggers: [{ char: '{', kind: 'command', allowedPrefixes: null }],
        }),
        Placeholder.configure({
          placeholder,
          showOnlyWhenEditable: true,
        }),
      ],
      content: initialContent,
      onUpdate: ({ editor }: { editor: Editor }) => {
        // Don't emit while the `{` picker chip is open — the trigger char is
        // transient and would otherwise land an invalid `{` in the expression.
        if (getOpenPickerRange(editor.state)) return
        const json = editor.getJSON()
        const newExpression = formulaToString(json)
        const sourceFields = extractFieldIds(json)

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
    [initialContent, fieldNode, placeholder]
  )

  const editor = useEditor(editorConfig)

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
        editor.commands.setContent(stringToFormula(newExpression))
        contentRef.current = newExpression
        setExpression(newExpression)
      }
    },
    [editor, expression]
  )

  /** Insert a field badge node, replacing the open `{` picker chip. */
  const insertField = useCallback(
    (fieldId: string) => {
      if (!editor) return
      const range = getOpenPickerRange(editor.state)
      if (!range) return
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'field', attrs: { id: fieldId } })
        .run()
    },
    [editor]
  )

  /** Insert a function call (`name(`), replacing the open `{` picker chip. */
  const insertFunction = useCallback(
    (funcName: string) => {
      if (!editor) return
      const range = getOpenPickerRange(editor.state)
      if (!range) return
      editor.chain().focus().deleteRange(range).insertContent(`${funcName}(`).run()
    },
    [editor]
  )

  /** Close the picker, removing the transient `{` trigger. */
  const closePicker = useCallback(() => {
    editor?.commands.closeReferencePicker({ keepText: false })
  }, [editor])

  return {
    editor,
    expression,
    validation,
    missingFields,
    sourceFields: validation.extractedFields,
    setContent,
    insertField,
    insertFunction,
    closePicker,
  }
}
