// apps/web/src/components/custom-fields/ui/ai-prompt-editor/use-ai-prompt.tsx

'use client'

import { extractFieldIdsFromPrompt, type RichReferencePrompt } from '@auxx/types/custom-field'
import Placeholder from '@tiptap/extension-placeholder'
import { type Editor, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createInlineNode,
  createInlinePickerExtension,
  type InlinePickerState,
} from '~/components/editor/inline-picker'
import { FieldBadge } from '../calc-editor/field-badge'

/**
 * An empty TipTap document. Used as the default when no prompt is set so
 * the editor always has a valid content root.
 */
export function emptyPromptDoc(): RichReferencePrompt {
  return { type: 'doc', content: [{ type: 'paragraph' }] }
}

/** Options for the `useAiPrompt` hook. */
export interface UseAiPromptOptions {
  /** Initial TipTap document (e.g. from field.options.ai.prompt). */
  initialPrompt?: RichReferencePrompt | null
  /** Fires on every content change with the canonical TipTap doc. */
  onChange?: (prompt: RichReferencePrompt, referencedFieldIds: string[]) => void
  /** Used by `FieldBadge` to resolve field labels inside the editor. */
  availableFields: Array<{ key: string; label: string; type: string }>
  /** Placeholder text for empty editor. */
  placeholder?: string
}

const closedSuggestionState: InlinePickerState = {
  isOpen: false,
  query: '',
  range: null,
  clientRect: null,
}

/**
 * TipTap hook for the AI prompt editor. Mirrors `useCalcFormula` but drops
 * the calc-expression validation and function-picker affordances: an AI
 * prompt is free text with inline `{fieldId}` references, nothing more.
 */
export function useAiPrompt({
  initialPrompt,
  onChange,
  availableFields,
  placeholder = 'Type { to insert a field, e.g., "Write a one-line intro for {fullName} who works at {company}."',
}: UseAiPromptOptions) {
  const [suggestionState, setSuggestionState] = useState<InlinePickerState>(closedSuggestionState)
  const onChangeRef = useRef(onChange)
  const suggestionRangeRef = useRef<{ from: number; to: number } | null>(null)
  const availableFieldsRef = useRef(availableFields)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    availableFieldsRef.current = availableFields
  }, [availableFields])

  useEffect(() => {
    suggestionRangeRef.current = suggestionState.range
  }, [suggestionState.range])

  const initialContent = useMemo(() => initialPrompt ?? emptyPromptDoc(), [initialPrompt])

  const handleSuggestionStateChange = useCallback((state: InlinePickerState) => {
    setSuggestionState(state)
  }, [])

  const pickerExtension = useMemo(
    () =>
      createInlinePickerExtension({
        type: 'field',
        trigger: '{',
        onStateChange: handleSuggestionStateChange,
      }),
    [handleSuggestionStateChange]
  )

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
          <FieldBadge id={id} selected={selected} availableFields={availableFieldsRef.current} />
        )
      ),
    []
  )

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
        pickerExtension,
        Placeholder.configure({ placeholder, showOnlyWhenEditable: true }),
      ],
      content: initialContent,
      onUpdate: ({ editor }: { editor: Editor }) => {
        const json = editor.getJSON() as RichReferencePrompt
        const referencedFieldIds = extractFieldIdsFromPrompt(json)
        onChangeRef.current?.(json, referencedFieldIds)
      },
      editorProps: {
        attributes: {
          class: 'ai-prompt-editor-content text-sm min-h-[80px] p-2 focus:outline-none',
        },
      },
      immediatelyRender: false,
      shouldRerenderOnTransaction: false,
    }),
    [initialContent, fieldNode, pickerExtension, placeholder]
  )

  const editor = useEditor(editorConfig)

  const insertField = useCallback(
    (fieldId: string) => {
      if (!editor || !suggestionRangeRef.current) return

      const range = suggestionRangeRef.current
      suggestionRangeRef.current = null

      editor
        .chain()
        .focus()
        .deleteRange({ from: range.from, to: range.to })
        .insertContent({ type: 'field', attrs: { id: fieldId } })
        .run()

      setSuggestionState(closedSuggestionState)
    },
    [editor]
  )

  const closeSuggestion = useCallback(() => {
    if (editor && suggestionRangeRef.current) {
      const range = suggestionRangeRef.current
      suggestionRangeRef.current = null
      editor.chain().focus().deleteRange({ from: range.from, to: range.to }).run()
    }
    setSuggestionState(closedSuggestionState)
    editor?.commands.focus()
  }, [editor])

  return {
    editor,
    suggestionState,
    insertField,
    closeSuggestion,
  }
}
