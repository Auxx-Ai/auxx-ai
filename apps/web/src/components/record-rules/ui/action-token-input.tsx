// apps/web/src/components/record-rules/ui/action-token-input.tsx

'use client'

import {
  ACTION_TOKEN_RECORD_NAME,
  isActionDoc,
  isRuleActionToken,
  legacyActionTextToDoc,
  SIGNAL_CONTEXT_TOKENS,
} from '@auxx/lib/record-rules/client'
import type { ResourceField } from '@auxx/lib/resources/client'
import type { TiptapDoc } from '@auxx/lib/tiptap'
import { fieldRefToKey } from '@auxx/types/field'
import { Badge } from '@auxx/ui/components/badge'
import {
  CommandGroup,
  CommandItem,
  CommandNavigation,
  useCommandNavigation,
} from '@auxx/ui/components/command'
import type { JSONContent } from '@tiptap/core'
import Placeholder from '@tiptap/extension-placeholder'
import { type Editor, EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Braces, Radio } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  createPlaceholderNode,
  getOpenPickerRange,
  type InlineNodeBadgeProps,
  InlinePickerPopover,
  PlaceholderBadge,
  ReferencePickerNode,
  stableStringify,
  stripOpenChips,
  useActivePicker,
} from '~/components/editor/inline-picker'
import {
  FieldPickerInnerContent,
  type FieldPickerNavigationItem,
} from '~/components/pickers/field-picker'

/**
 * A fresh empty action doc — the add-action / type-switch default for the token-bearing
 * fields (`create-task.title`, `notify.message`, `set-field.value`). Fails every
 * completeness check until the user types, so an untouched action stays invalid.
 */
export function emptyActionDoc(): TiptapDoc {
  return { type: 'doc', content: [{ type: 'paragraph' }] }
}

/**
 * Normalize an incoming action field value to a Tiptap doc for the editor. Docs pass
 * through; anything else (a stray string, a raw set-field primitive) is defensively
 * converted via `legacyActionTextToDoc`.
 */
function toDoc(value: unknown): TiptapDoc {
  if (isActionDoc(value)) return value
  if (typeof value === 'string') return legacyActionTextToDoc(value)
  return legacyActionTextToDoc(value == null ? '' : String(value))
}

/**
 * Chip renderer for action-token placeholder nodes. Rule-specific tokens
 * (`record:name`, `signal:*`) render as plain labeled badges — they aren't in the
 * shared placeholder catalog, so `PlaceholderBadge` would flag them unresolved.
 * Everything else (field tokens) reuses `PlaceholderBadge` and gets the breadcrumb
 * label + fallback/format popover for free.
 */
function ActionTokenBadge(props: InlineNodeBadgeProps) {
  const { id, selected } = props
  if (isRuleActionToken(id)) {
    const label =
      id === ACTION_TOKEN_RECORD_NAME
        ? 'Record name'
        : (SIGNAL_CONTEXT_TOKENS.find((t) => t.id === id)?.label ?? id)
    return (
      <Badge
        variant='pill'
        size='sm'
        data-selected={selected || undefined}
        className='h-5 mx-0.5 px-1.5 py-0 text-xs align-baseline inline-flex items-center'
        title={id}>
        {label}
      </Badge>
    )
  }
  // A signal-ish id that isn't a known token (e.g. hand-typed `signal:foo`) — flag it.
  if (id.startsWith('signal:')) {
    return (
      <Badge
        variant='destructive'
        size='sm'
        data-selected={selected || undefined}
        className='h-5 mx-0.5 px-1.5 py-0 text-xs align-baseline inline-flex items-center'
        title={id}>
        {id}
      </Badge>
    )
  }
  return <PlaceholderBadge {...props} />
}

// Module-level extensions — no props captured, safe to share across instances.
const placeholderNode = createPlaceholderNode((props) => <ActionTokenBadge {...props} />)
const pickerNode = ReferencePickerNode.configure({
  triggers: [{ char: '{', kind: 'command', allowedPrefixes: null }],
})

/** Case-insensitive substring match for the custom (non-field) picker items. */
function matchesSearch(label: string, search: string): boolean {
  return !search || label.toLowerCase().includes(search.toLowerCase().trim())
}

interface ActionTokenPickerProps {
  entityDefinitionId: string
  fields: ResourceField[]
  isSignalRule: boolean
  onSelect: (id: string) => void
  onClose: () => void
}

/**
 * Command-rooted picker body: the rule's record fields (with relationship drill-down
 * via `FieldPickerInnerContent`), a 'Record name' token, and — on signal rules — the
 * signal-context tokens. Field selections are emitted as placeholder ids via
 * `fieldRefToKey`, the exact scheme `tryParsePlaceholderId` parses back.
 */
function ActionTokenPicker(props: ActionTokenPickerProps) {
  return (
    <CommandNavigation<FieldPickerNavigationItem>>
      <ActionTokenPickerInner {...props} />
    </CommandNavigation>
  )
}

function ActionTokenPickerInner({
  entityDefinitionId,
  fields,
  isSignalRule,
  onSelect,
  onClose,
}: ActionTokenPickerProps) {
  const { isAtRoot } = useCommandNavigation<FieldPickerNavigationItem>()

  const renderRecordGroup = (search: string) => {
    if (!matchesSearch('Record name', search)) return null
    return (
      <CommandGroup heading='Record'>
        <CommandItem
          value={ACTION_TOKEN_RECORD_NAME}
          onSelect={() => onSelect(ACTION_TOKEN_RECORD_NAME)}>
          <Braces className='size-4 text-muted-foreground' />
          <span>Record name</span>
        </CommandItem>
      </CommandGroup>
    )
  }

  const renderSignalGroup = (search: string) => {
    const tokens = SIGNAL_CONTEXT_TOKENS.filter((t) => matchesSearch(t.label, search))
    if (tokens.length === 0) return null
    return (
      <CommandGroup heading='Signal'>
        {tokens.map((t) => (
          <CommandItem key={t.id} value={t.id} onSelect={() => onSelect(t.id)}>
            <Radio className='size-4 text-muted-foreground' />
            <span>{t.label}</span>
          </CommandItem>
        ))}
      </CommandGroup>
    )
  }

  return (
    <FieldPickerInnerContent
      entityDefinitionId={entityDefinitionId}
      fields={fields}
      mode='single'
      onSelect={(fieldRef) => onSelect(fieldRefToKey(fieldRef))}
      onBackFromRoot={onClose}
      searchPlaceholder='Search tokens...'
      renderHeaderContent={isAtRoot ? renderRecordGroup : undefined}
      renderAdditionalContent={isAtRoot && isSignalRule ? renderSignalGroup : undefined}
    />
  )
}

export interface ActionTokenInputProps {
  /** Current field value — a Tiptap doc (strays are defensively normalized). */
  value: unknown
  onChange: (doc: TiptapDoc) => void
  /** The rule's record type — roots the field tokens the picker offers. */
  entityDefinitionId: string
  /** The record type's fields (same list the condition builder shows). */
  fields: ResourceField[]
  /** Offer the signal-context tokens (only meaningful on `on === 'signal'` rules). */
  isSignalRule: boolean
  placeholder?: string
}

/**
 * Single-line token input for the text-bearing rule-action fields
 * (plans/signals/07-action-placeholders.md). Looks like a plain `FieldInputAdapter`
 * TEXT input, but typing `{` opens an inline token picker; committed tokens render as
 * chips and persist as `placeholder` nodes in the emitted Tiptap doc.
 */
export function ActionTokenInput({
  value,
  onChange,
  entityDefinitionId,
  fields,
  isSignalRule,
  placeholder = 'Type { to insert a field…',
}: ActionTokenInputProps) {
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  // Seed content once; later external changes flow through the reseed effect below.
  const initialDocRef = useRef<TiptapDoc | null>(null)
  if (initialDocRef.current === null) initialDocRef.current = toDoc(value)
  const contentRef = useRef(stableStringify(initialDocRef.current))

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
        placeholderNode,
        pickerNode,
        Placeholder.configure({ placeholder, showOnlyWhenEditable: true }),
      ],
      content: initialDocRef.current as JSONContent,
      onUpdate: ({ editor }: { editor: Editor }) => {
        // Don't emit while the `{` picker chip is open — the transient chip would
        // otherwise land in the value.
        if (getOpenPickerRange(editor.state)) return
        const next = stripOpenChips(editor.getJSON()) as TiptapDoc
        const key = stableStringify(next)
        if (key !== contentRef.current) {
          contentRef.current = key
          onChangeRef.current?.(next)
        }
      },
      editorProps: {
        attributes: {
          class: 'text-sm focus:outline-none whitespace-nowrap overflow-x-auto',
        },
        // Single-line: swallow Enter so the doc never gains a paragraph. (When the
        // picker is open, focus is in the popover, so this won't interfere.)
        handleKeyDown: (_view: unknown, event: KeyboardEvent) => {
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
    [placeholder]
  )

  const editor = useEditor(editorConfig)

  // Reseed only on a genuine external change (selecting another action, a server
  // refresh) — never echo our own onChange back (would jump the cursor).
  useEffect(() => {
    const doc = toDoc(value)
    const key = stableStringify(doc)
    if (key !== contentRef.current) {
      contentRef.current = key
      editor?.commands.setContent(doc as JSONContent)
    }
  }, [value, editor])

  /** Insert a token chip, replacing the open `{` picker chip. */
  const insertToken = useCallback(
    (id: string) => {
      if (!editor) return
      const range = getOpenPickerRange(editor.state)
      if (!range) return
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'placeholder', attrs: { id } })
        .insertContent(' ')
        .run()
    },
    [editor]
  )

  const closePicker = useCallback(() => {
    editor?.commands.closeReferencePicker({ keepText: false })
  }, [editor])

  const activePicker = useActivePicker(editor)
  const pickerOpen = !!activePicker && activePicker.trigger === '{'

  return (
    // Mirrors the FieldInputAdapter TEXT look (transparent input, min-h-8, text-sm)
    // so the row matches its sibling inputs inside a FieldPanelRow.
    <div className='relative flex w-full min-h-8 items-center'>
      <EditorContent
        editor={editor}
        className='w-full text-sm [&_.ProseMirror]:w-full [&_.ProseMirror]:min-h-[1.25rem] [&_.ProseMirror]:outline-none [&_p]:m-0'
      />
      {editor && (
        <InlinePickerPopover
          state={{
            isOpen: pickerOpen,
            query: activePicker?.query ?? '',
            range: null,
            clientRect: activePicker?.clientRect ?? null,
          }}
          width={320}
          onClose={closePicker}>
          <ActionTokenPicker
            entityDefinitionId={entityDefinitionId}
            fields={fields}
            isSignalRule={isSignalRule}
            onSelect={(id) => {
              insertToken(id)
              closePicker()
            }}
            onClose={closePicker}
          />
        </InlinePickerPopover>
      )}
    </div>
  )
}
