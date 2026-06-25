// apps/web/src/components/global/token-field/token-field-editor.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { EditorContent } from '@tiptap/react'
import { InlinePickerPopover, useActivePicker } from '~/components/editor/inline-picker'
import type { HttpFieldEditor, HttpFieldEditorProps } from '~/components/global/http-request'
import type { TokenSource } from './token-source'
import { useTokenField } from './use-token-field'

/**
 * A `{token}`-aware {@link HttpFieldEditor}: a single-line (or multiline) TipTap
 * field whose `{` opens the inline token picker. Drop-in replacement for
 * `PlainFieldEditor` in the shared HTTP request builder — wire it through
 * `HttpRequestFieldProvider` so header / param values gain token insertion with
 * no changes to the key-value rows.
 *
 * Bind a {@link TokenSource} via {@link makeTokenFieldEditor}; the resulting
 * component matches the `HttpFieldEditor` contract exactly.
 */
function TokenFieldEditor({
  value,
  onChange,
  onBlur,
  placeholder,
  disabled,
  multiline,
  className,
  tokenSource,
}: HttpFieldEditorProps & { tokenSource: TokenSource }) {
  const { editor, insertField, closePicker } = useTokenField({
    initialValue: value,
    onChange,
    renderBadge: tokenSource.renderBadge,
    placeholder,
    multiline,
    editable: !disabled,
  })

  const activePicker = useActivePicker(editor)
  const pickerOpen = !!activePicker && activePicker.trigger === '{'
  const query = activePicker?.query ?? ''

  return (
    // The incoming `className` (e.g. `p-1 h-full focus-within:bg-…` from the
    // key-value cell) rides the OUTER box so the background + height cover the
    // whole cell. `onBlur` rides it too — focusout bubbles from the contenteditable,
    // and `EditorContent` doesn't forward arbitrary handlers. Single-line content is
    // vertically centered so a token row matches a plain key row's height.
    <div
      className={cn('relative flex w-full', multiline ? 'items-start' : 'items-center', className)}
      onBlur={onBlur}>
      <EditorContent
        editor={editor}
        className='w-full text-sm [&_.ProseMirror]:min-h-[1.25rem] [&_.ProseMirror]:pl-2 [&_.ProseMirror]:outline-none [&_p]:m-0'
      />
      {editor && (
        <InlinePickerPopover
          state={{
            isOpen: pickerOpen,
            query,
            range: null,
            clientRect: activePicker?.clientRect ?? null,
          }}
          width={300}
          onClose={closePicker}>
          {tokenSource.renderPickerItems({
            query,
            onSelect: (id) => {
              insertField(id)
              closePicker()
            },
            onClose: closePicker,
          })}
        </InlinePickerPopover>
      )}
    </div>
  )
}

/** Bind a {@link TokenSource} into an `HttpFieldEditor` for the request-field seam. */
export function makeTokenFieldEditor(tokenSource: TokenSource): HttpFieldEditor {
  return function BoundTokenFieldEditor(props: HttpFieldEditorProps) {
    return <TokenFieldEditor {...props} tokenSource={tokenSource} />
  }
}
