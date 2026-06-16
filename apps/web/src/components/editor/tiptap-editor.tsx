// apps/web/src/components/editor/tiptap-editor.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import type { JSONContent } from '@tiptap/core'
import Color from '@tiptap/extension-color'
import FontFamily from '@tiptap/extension-font-family'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import TextAlign from '@tiptap/extension-text-align'
import TextStyle from '@tiptap/extension-text-style'
import Underline from '@tiptap/extension-underline'
import { type Editor, EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import '~/styles/prosemirror.css'
import { MailSlashContent } from '~/components/mail/email-editor/mail-slash-content'
import { useEditorContext } from './editor-context'
import { FontSize } from './extensions'
import { Indent } from './extensions/indent'
import {
  createPlaceholderNode,
  getOpenPickerRange,
  InlinePickerPopover,
  PlaceholderBadge,
  ReferencePickerNode,
  stableStringify,
  stripOpenChips,
  useActivePicker,
  useExternalContentSync,
  useHasOpenChip,
} from './inline-picker'
import type { SlashContentHandle } from './slash-commands/slash-list'

type TiptapEditorProps = {
  content: JSONContent
  onChange: (json: JSONContent) => void
  placeholder?: string
  className?: string
  /** Extra class applied to the outer `EditorContent` wrapper (overrides defaults via twMerge). Use to tweak padding, min-height, text size, etc. */
  contentClassName?: string
  editable?: boolean
  /** Extra class (e.g. z-index override) for the slash-command popover content. */
  popoverClassName?: string
  /** When provided, plain Enter (no shift) calls this handler instead of inserting a paragraph break. */
  onEnter?: () => void
}

const TiptapEditor = ({
  content,
  onChange,
  placeholder = 'Type your reply here...',
  className = '',
  contentClassName,
  editable = true,
  popoverClassName,
  onEnter,
}: TiptapEditorProps) => {
  const { setEditor } = useEditorContext()
  const externalSyncRef = useRef<{ markLocalEdit: (key: string) => void }>({
    markLocalEdit: () => {},
  })
  const onEnterRef = useRef<(() => void) | undefined>(onEnter)
  onEnterRef.current = onEnter

  // Keyboard forwarded from the open `/` chip to the slash list (focus stays
  // in the editor — see `useCmdkRemote`).
  const slashRef = useRef<SlashContentHandle | null>(null)
  const onSlashEnter = useCallback(() => slashRef.current?.confirmHighlighted() ?? false, [])
  const onSlashArrowVertical = useCallback(
    (dir: 1 | -1) => slashRef.current?.moveHighlight(dir) ?? false,
    []
  )
  const onSlashBackspacePop = useCallback(() => slashRef.current?.popLevel() ?? false, [])
  const onSlashArrowRight = useCallback(() => slashRef.current?.drillHighlighted() ?? false, [])

  const placeholderNodeExtension = useMemo(
    () => createPlaceholderNode((badgeProps) => <PlaceholderBadge {...badgeProps} />),
    []
  )

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Indent,
      TextStyle,
      FontFamily,
      FontSize,
      Color,
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder }),
      // `/`-only chip picker: no `@` mention (mail has no references) — typing
      // `@` inserts a literal character. The popover is mounted below via
      // `useActivePicker`; keyboard is forwarded through the `onSlash*` hooks.
      ReferencePickerNode.configure({
        mention: false,
        slash: true,
        onSlashEnter,
        onSlashArrowVertical,
        onSlashBackspacePop,
        onSlashArrowRight,
      }),
      placeholderNodeExtension,
    ],
    [
      placeholder,
      placeholderNodeExtension,
      onSlashEnter,
      onSlashArrowVertical,
      onSlashBackspacePop,
      onSlashArrowRight,
    ]
  )

  const editorInstance = useEditor(
    {
      extensions,
      content,
      shouldRerenderOnTransaction: false,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class: cn(
            'tiptap-email-editor prose prose-sm prose-headings:my-1 prose-ul:my-1 prose-p:my-0 prose-li:my-0 focus:outline-hidden max-w-none dark:prose-invert flex-1',
            className
          ),
        },
        handleKeyDown: (_view, event) => {
          // While a `/` chip is open its own keyboard plugin consumes Enter
          // (reference-picker-node.tsx), so this only fires with no chip open.
          if (
            onEnterRef.current &&
            event.key === 'Enter' &&
            !event.shiftKey &&
            !event.metaKey &&
            !event.ctrlKey
          ) {
            event.preventDefault()
            onEnterRef.current()
            return true
          }
          return false
        },
      },
      onCreate: ({ editor }) => {
        setEditor(editor)
      },
      onDestroy: () => {
        setEditor(null)
      },
      onUpdate: ({ editor, transaction }) => {
        if (!transaction.docChanged) return
        // Any open picker chip is emitted as its literal text — onChange
        // consumers (autosave, dirty marking) never see the transient node,
        // so no open/closed gating is needed.
        const json = stripOpenChips(editor.getJSON())
        externalSyncRef.current.markLocalEdit(stableStringify(json))
        onChange(json)
      },
    },
    []
  )

  const applyContent = useCallback((instance: Editor, next: JSONContent) => {
    // Skip when the editor already matches — useEditor initialized with the
    // same doc, so a redundant setContent here would trigger TipTap's React
    // adapters to flushSync during commit. stableStringify so JSONB key
    // reordering doesn't make a same-content doc look different.
    if (stableStringify(instance.getJSON()) === stableStringify(next)) return
    const { from, to } = instance.state.selection
    instance.commands.setContent(next, false)
    try {
      instance.commands.setTextSelection({ from, to })
    } catch {
      instance.commands.focus('end')
    }
  }, [])
  const canonicalKey = useCallback((json: JSONContent) => stableStringify(json), [])

  // An inbound apply while a chip is open would destroy it — defer until close.
  const hasOpenChip = useHasOpenChip(editorInstance)

  const syncHandle = useExternalContentSync<JSONContent>({
    editor: editorInstance,
    incoming: content,
    isPickerOpen: hasOpenChip,
    applyContent,
    canonicalKey,
  })
  externalSyncRef.current = syncHandle.current

  // Synchronize editable state
  useEffect(() => {
    if (!editorInstance || editorInstance.isDestroyed) return
    editorInstance.setEditable(editable)
  }, [editable, editorInstance])

  // Reactive view of the open chip — drives the slash popover mount + anchor.
  const activePicker = useActivePicker(editorInstance)
  const slashOpen = !!activePicker && activePicker.trigger === '/'

  // Run a slash executor with the open chip's range — the executor's chain
  // deletes the chip and applies the command in one transaction.
  const runWithChipRange = useCallback(
    (cmd: (editor: Editor, range: { from: number; to: number }) => void) => {
      if (!editorInstance) return
      const range = getOpenPickerRange(editorInstance.state)
      if (!range) return
      cmd(editorInstance, range)
    },
    [editorInstance]
  )
  const changeSlashScope = useCallback(
    (scope: string | null) => {
      editorInstance?.commands.setPickerScope(scope, { clearQuery: true })
    },
    [editorInstance]
  )
  const closeSlash = useCallback(() => {
    editorInstance?.commands.closeReferencePicker({ keepText: true })
  }, [editorInstance])

  // Keep the popover open when the click lands on the chip pill itself.
  const onChipInteractOutside = useCallback((e: Event) => {
    const target = e.target as HTMLElement | null
    if (target?.closest('[data-type="reference-picker"]')) {
      e.preventDefault()
    }
  }, [])

  return (
    <>
      <EditorContent
        editor={editorInstance}
        className={cn(
          'w-full h-full flex flex-col bg-transparent px-4 py-3 text-[15px] leading-relaxed text-foreground outline-hidden ring-0 sm:min-h-[120px] *:outline-hidden',
          contentClassName
        )}
      />
      {editorInstance && (
        <InlinePickerPopover
          state={{
            isOpen: slashOpen,
            query: activePicker?.query ?? '',
            range: null,
            clientRect: activePicker?.clientRect ?? null,
          }}
          width={288}
          side='bottom'
          align='start'
          autoFocus={false}
          className={popoverClassName}
          onInteractOutside={onChipInteractOutside}
          onClose={closeSlash}>
          <MailSlashContent
            ref={slashRef}
            query={activePicker?.query ?? ''}
            editor={editorInstance}
            onExecute={runWithChipRange}
            onScopeChange={changeSlashScope}
            onClose={closeSlash}
          />
        </InlinePickerPopover>
      )}
    </>
  )
}

export default TiptapEditor
