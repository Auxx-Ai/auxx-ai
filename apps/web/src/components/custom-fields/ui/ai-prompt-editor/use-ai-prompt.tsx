// apps/web/src/components/custom-fields/ui/ai-prompt-editor/use-ai-prompt.tsx

'use client'

import { extractFieldIdsFromPrompt, type RichReferencePrompt } from '@auxx/types/custom-field'
import Placeholder from '@tiptap/extension-placeholder'
import { type Editor, type JSONContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  createInlineNode,
  getOpenPickerRange,
  ReferencePickerNode,
} from '~/components/editor/inline-picker'
import { FieldBadge } from '~/components/resources/ui'

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
  /** Entity context — used by `FieldBadge` to resolve plain-FieldId references. */
  entityDefinitionId: string
  /** Placeholder text for empty editor. */
  placeholder?: string
}

/**
 * TipTap hook for the AI prompt editor. Mirrors `useCalcFormula` but drops
 * the calc-expression validation and function-picker affordances: an AI
 * prompt is free text with inline `{fieldId}` references, nothing more.
 *
 * The `{`-triggered field picker rides on the shared `ReferencePickerNode`
 * chip; the consumer mounts the popover via `useActivePicker` +
 * `InlinePickerPopover` and commits selections through `insertField`.
 */
export function useAiPrompt({
  initialPrompt,
  onChange,
  entityDefinitionId,
  placeholder = 'Type { to insert a field, e.g., "Write a one-line intro for {fullName} who works at {company}."',
}: UseAiPromptOptions) {
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const initialContent = useMemo(() => initialPrompt ?? emptyPromptDoc(), [initialPrompt])

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
        // `{` fires mid-word (allowedPrefixes: null) — authors write prose like
        // "intro for {fullName}" where the `{` follows non-space text.
        ReferencePickerNode.configure({
          triggers: [{ char: '{', kind: 'command', allowedPrefixes: null }],
        }),
        Placeholder.configure({ placeholder, showOnlyWhenEditable: true }),
      ],
      // `RichReferencePrompt` is the deliberately permissive persisted shape of a
      // TipTap doc (`content?: unknown[]`); every value reaching here came from
      // `editor.getJSON()` or `emptyPromptDoc()`.
      content: initialContent as JSONContent,
      onUpdate: ({ editor }: { editor: Editor }) => {
        // Skip while the `{` picker chip is open — the transient chip must
        // never be persisted into the saved prompt doc.
        if (getOpenPickerRange(editor.state)) return
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
    [initialContent, fieldNode, placeholder]
  )

  const editor = useEditor(editorConfig)

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

  /** Close the picker, removing the transient `{` trigger. */
  const closePicker = useCallback(() => {
    editor?.commands.closeReferencePicker({ keepText: false })
  }, [editor])

  return {
    editor,
    insertField,
    closePicker,
  }
}
