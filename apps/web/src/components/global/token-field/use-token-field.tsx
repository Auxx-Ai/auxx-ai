// apps/web/src/components/global/token-field/use-token-field.tsx

'use client'

import { formulaToString, stringToFormula } from '@auxx/lib/custom-fields/client'
import type { JSONContent } from '@tiptap/core'
import Placeholder from '@tiptap/extension-placeholder'
import { type Editor, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createInlineNode,
  getOpenPickerRange,
  ReferencePickerNode,
} from '~/components/editor/inline-picker'
import type { TokenSource } from './token-source'

export interface UseTokenFieldOptions {
  /** Initial interpolated string, e.g. `orders/{id}.json`. */
  initialValue?: string
  /** Emits the new interpolated string on every edit. */
  onChange?: (value: string) => void
  /** Renders the `{token}` chips inside the editor. */
  renderBadge: TokenSource['renderBadge']
  placeholder?: string
  /** Single-line by default; multiline allows wrapping (body editors). */
  multiline?: boolean
  editable?: boolean
}

/**
 * The lean sibling of {@link useCalcFormula}: a `{token}`-aware TipTap field with
 * no calc functions, no expression validation, single-line by default. Typing `{`
 * opens the inline token picker; selection collapses to a `field` chip that
 * serializes back to `{id}`. Used for HTTP request fields (URL / header / param
 * values) where the tokens are webhook-steering payload paths.
 *
 * Reuses the shared `{id}` ↔ TipTap converters (`stringToFormula`/`formulaToString`)
 * — they are token-source-agnostic despite the calc-field naming.
 */
export function useTokenField({
  initialValue = '',
  onChange,
  renderBadge,
  placeholder = 'Type { to insert a field…',
  multiline = false,
  editable = true,
}: UseTokenFieldOptions) {
  const [value, setValue] = useState(initialValue)
  const contentRef = useRef(initialValue)
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const initialContent = useMemo(() => stringToFormula(initialValue) as JSONContent, [initialValue])

  // Any non-brace token auto-chips (`{customer.email}`, `{id}`), mirroring the
  // calc field node — so hand-typed dotted paths collapse to a chip too.
  const fieldNode = useMemo(
    () =>
      createInlineNode(
        {
          type: 'field',
          serialize: (id) => `{${id}}`,
          pastePattern: { pattern: /\{([^{}]+)\}/, getId: (match) => match[1]! },
          inputRules: [{ find: /\{([^{}]+)\}$/, getId: (match) => match[1]! }],
        },
        ({ id, selected }) => renderBadge(id, selected)
      ),
    [renderBadge]
  )

  const editorConfig = useMemo(
    () => ({
      editable,
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
        ReferencePickerNode.configure({
          triggers: [{ char: '{', kind: 'command', allowedPrefixes: null }],
        }),
        Placeholder.configure({ placeholder, showOnlyWhenEditable: true }),
      ],
      content: initialContent,
      onUpdate: ({ editor }: { editor: Editor }) => {
        // Don't emit while the `{` picker chip is open — the transient `{` would
        // otherwise land in the value.
        if (getOpenPickerRange(editor.state)) return
        const next = formulaToString(editor.getJSON() as JSONContent)
        if (next !== contentRef.current) {
          contentRef.current = next
          setValue(next)
          onChangeRef.current?.(next)
        }
      },
      editorProps: {
        attributes: {
          class: `token-field-content text-sm focus:outline-none ${
            multiline ? 'whitespace-pre-wrap break-words' : 'whitespace-nowrap overflow-x-auto'
          }`,
        },
        // Single-line: swallow Enter so the value never gains a newline. (When the
        // picker is open, focus is in the popover, not the editor, so this won't
        // interfere with picker navigation.)
        handleKeyDown: multiline
          ? undefined
          : (_view: unknown, event: KeyboardEvent) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                return true
              }
              return false
            },
      },
      immediatelyRender: false,
      shouldRerenderOnTransaction: false,
    }),
    [initialContent, fieldNode, placeholder, multiline, editable]
  )

  const editor = useEditor(editorConfig)

  // `editable` can flip after mount (a stream goes read-only); useEditor won't
  // rebuild from config, so push it imperatively.
  useEffect(() => {
    editor?.setEditable(editable)
  }, [editor, editable])

  // Reseed only on a genuine external change (switching streams, a server move) —
  // never echo our own onChange back into the editor (would jump the cursor).
  useEffect(() => {
    if (initialValue !== contentRef.current) {
      contentRef.current = initialValue
      setValue(initialValue)
      editor?.commands.setContent(stringToFormula(initialValue) as JSONContent)
    }
  }, [initialValue, editor])

  /** Insert a token chip, replacing the open `{` picker chip. */
  const insertField = useCallback(
    (id: string) => {
      if (!editor) return
      const range = getOpenPickerRange(editor.state)
      if (!range) return
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'field', attrs: { id } })
        .run()
    },
    [editor]
  )

  const closePicker = useCallback(() => {
    editor?.commands.closeReferencePicker({ keepText: false })
  }, [editor])

  return { editor, value, insertField, closePicker }
}
