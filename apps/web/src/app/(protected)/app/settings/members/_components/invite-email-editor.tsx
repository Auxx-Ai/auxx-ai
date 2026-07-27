// apps/web/src/app/(protected)/app/settings/members/_components/invite-email-editor.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import Placeholder from '@tiptap/extension-placeholder'
import type { Fragment, Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { AlertTriangle, Trash2, User } from 'lucide-react'
import type React from 'react'
import { useImperativeHandle } from 'react'
import { createInlineNode, type InlineNodeBadgeProps } from '~/components/editor/inline-picker'
import { Tooltip } from '~/components/global/tooltip'

const NODE_TYPE = 'inviteEmail'

/** Placeholder char standing in for a chip when reading the text before the
 * caret, so string offsets stay in step with ProseMirror positions. */
const LEAF_CHAR = '￼'

/** The half-typed address directly before the caret (stops at a chip or separator). */
const PENDING_RE = new RegExp(`[^\\s,;${LEAF_CHAR}]+$`)

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Whether an entry can actually be invited. Drives the chip's warning state. */
export function isValidInviteEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value)
}

/** `Carl Meier <c@acme.com>` / `<c@acme.com>` / `c@acme.com,` → `c@acme.com`. */
function normalizeEntry(raw: string): string {
  const angled = /<([^>]*)>/.exec(raw)
  const value = (angled?.[1] ?? raw).trim().replace(/^[<"']+|[>"',;.]+$/g, '')
  return value.toLowerCase()
}

/**
 * Splits pasted text into candidate addresses — names are dropped
 * (`Name <a@b.com>` keeps only the address), the rest splits on whitespace,
 * commas and semicolons. Junk survives as an entry on purpose: it becomes a
 * warning chip the user can see and fix instead of being silently swallowed.
 */
function parseEntries(text: string): string[] {
  return text
    .replace(/"[^"]*"/g, ' ')
    .replace(/[^<>,;\s]*\s*<([^>]*)>/g, ' $1 ')
    .split(/[\s,;]+/)
    .map(normalizeEntry)
    .filter(Boolean)
}

/** Every chipped address, in document order. */
function collectEntries(doc: ProseMirrorNode): string[] {
  const entries: string[] = []
  doc.descendants((node) => {
    if (node.type.name === NODE_TYPE) entries.push(node.attrs.id as string)
  })
  return entries
}

/** Addresses and loose text in a copied slice, in document order. */
function partsInFragment(fragment: Fragment): string[] {
  const parts: string[] = []
  fragment.forEach((node) => {
    if (node.type.name === NODE_TYPE) {
      parts.push(node.attrs.id as string)
    } else if (node.isText) {
      const text = node.text?.trim()
      if (text) parts.push(text)
    } else if (node.content.size) {
      parts.push(...partsInFragment(node.content))
    }
  })
  return parts
}

/** The half-typed text before the caret, or '' when there is none. */
function pendingText(view: EditorView): string {
  const { $from, empty } = view.state.selection
  if (!empty) return ''
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, LEAF_CHAR)
  return PENDING_RE.exec(before)?.[0] ?? ''
}

/**
 * Turns the text run before the caret into a chip. A duplicate is dropped
 * rather than added — the chip the user already has is the one that stays.
 */
function commitPending(view: EditorView): boolean {
  const token = pendingText(view)
  if (!token) return false

  const { state } = view
  const { $from } = state.selection
  const from = $from.pos - token.length
  const to = $from.pos
  const entry = normalizeEntry(token)
  const nodeType = state.schema.nodes[NODE_TYPE]
  if (!nodeType) return false

  const tr =
    entry && !collectEntries(state.doc).includes(entry)
      ? state.tr.replaceWith(from, to, nodeType.create({ id: entry }))
      : state.tr.delete(from, to)

  view.dispatch(tr)
  return true
}

/** One address chip: user icon + address + trash, warning-styled when invalid. */
function InviteEmailBadge({ id, selected, deleteNode }: InlineNodeBadgeProps) {
  const invalid = !isValidInviteEmail(id)

  const badge = (
    <Badge
      variant={invalid ? 'destructive' : 'user'}
      className={cn('me-1 my-0.5 gap-1 py-0.5 font-normal', selected && 'ring-2 ring-info')}>
      {invalid ? (
        <AlertTriangle className='size-3 shrink-0' />
      ) : (
        <User className='size-3 shrink-0' />
      )}
      <span>{id}</span>
      <button
        type='button'
        aria-label={`Remove ${id}`}
        className='ms-0.5 rounded-sm opacity-60 transition-opacity hover:opacity-100'
        // Keep the caret where it is — blurring here would commit half-typed text.
        onMouseDown={(e) => e.preventDefault()}
        onClick={deleteNode}>
        <Trash2 className='size-3' />
      </button>
    </Badge>
  )

  return invalid ? <Tooltip content='Not a valid email address'>{badge}</Tooltip> : badge
}

/** The chip node. Module-scoped: the badge needs no React context, so there is
 * nothing to close over per mount. */
const inviteEmailNode = createInlineNode({ type: NODE_TYPE, serialize: (id) => id }, (props) => (
  <InviteEmailBadge {...props} />
))

export interface InviteEmailEditorHandle {
  /** Commits any half-typed address, then returns every chipped entry. */
  flush: () => string[]
}

interface InviteEmailEditorProps {
  ref?: React.Ref<InviteEmailEditorHandle>
  /** Addresses to start with (e.g. carried over from the single-invite popover). */
  initialEmails?: string[]
  /** Fires whenever the set of chips changes. */
  onChange: (entries: string[]) => void
  placeholder?: string
  disabled?: boolean
}

/**
 * Tiptap-based multi-address input: every entry is an atom node rendered as a
 * removable badge. Addresses commit on a separator key, Enter, Tab or blur, and
 * a paste is split into one chip per address — invalid ones included, so the
 * warning is visible before sending instead of coming back as a server error.
 */
export function InviteEmailEditor({
  ref,
  initialEmails,
  onChange,
  placeholder = 'Paste or type email addresses, separated by commas',
  disabled,
}: InviteEmailEditorProps) {
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: false,
          bulletList: false,
          orderedList: false,
          listItem: false,
          blockquote: false,
          codeBlock: false,
          horizontalRule: false,
          bold: false,
          italic: false,
          strike: false,
          code: false,
        }),
        Placeholder.configure({ placeholder }),
        inviteEmailNode,
      ],
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: (initialEmails ?? [])
              .map(normalizeEntry)
              .filter(Boolean)
              .map((id) => ({ type: NODE_TYPE, attrs: { id } })),
          },
        ],
      },
      editable: !disabled,
      immediatelyRender: false,
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: {
          class:
            'prose prose-sm prose-p:my-0 focus:outline-hidden max-w-none dark:prose-invert flex-1',
        },
        // Chips are atoms with no text between them, so the default plain-text
        // serialization would run them together (`a@x.comb@y.com`) on copy/cut.
        clipboardTextSerializer: (slice) => partsInFragment(slice.content).join(', '),
        handleKeyDown: (view, event) => {
          // Cmd/Ctrl+Enter is the dialog's submit shortcut — leave it alone.
          if (event.metaKey || event.ctrlKey) return false

          const isSeparator = event.key.length === 1 && /[\s,;]/.test(event.key)
          if (!isSeparator && event.key !== 'Enter' && event.key !== 'Tab') return false

          if (commitPending(view)) return true
          // Nothing pending: swallow separators and Enter (the doc stays one
          // paragraph), but let Tab move focus out of the editor.
          return event.key !== 'Tab'
        },
        handlePaste: (view, event) => {
          const text = event.clipboardData?.getData('text/plain')
          if (!text) return false
          const entries = parseEntries(text)
          if (entries.length === 0) return false

          const { state } = view
          const nodeType = state.schema.nodes[NODE_TYPE]
          if (!nodeType) return false

          event.preventDefault()
          const seen = new Set(collectEntries(state.doc))
          const nodes: ProseMirrorNode[] = []
          for (const entry of entries) {
            if (seen.has(entry)) continue
            seen.add(entry)
            nodes.push(nodeType.create({ id: entry }))
          }

          const { from, to } = state.selection
          view.dispatch(state.tr.replaceWith(from, to, nodes))
          return true
        },
      },
      onUpdate: ({ editor }) => onChange(collectEntries(editor.state.doc)),
      onBlur: ({ editor }) => {
        commitPending(editor.view)
        onChange(collectEntries(editor.state.doc))
      },
    },
    []
  )

  useImperativeHandle(
    ref,
    () => ({
      flush: () => {
        if (!editor) return []
        commitPending(editor.view)
        return collectEntries(editor.state.doc)
      },
    }),
    [editor]
  )

  return (
    <div
      className={cn(
        'relative rounded-md border focus-within:ring-2 focus-within:ring-info',
        disabled && 'opacity-60'
      )}>
      <EditorContent
        editor={editor}
        className='w-full h-full flex flex-col bg-transparent px-3 py-2 text-[15px] leading-relaxed text-foreground outline-hidden ring-0 min-h-[160px] *:outline-hidden'
      />
    </div>
  )
}
