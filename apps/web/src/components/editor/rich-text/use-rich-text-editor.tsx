// apps/web/src/components/editor/rich-text/use-rich-text-editor.tsx

'use client'

import type { JSONContent } from '@tiptap/core'
import { Extension, Node } from '@tiptap/core'
import Color from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import Link from '@tiptap/extension-link'
import TextAlign from '@tiptap/extension-text-align'
import TextStyle from '@tiptap/extension-text-style'
import Underline from '@tiptap/extension-underline'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { ConditionBlock } from '~/components/agents/procedures/nodes/condition-block-node'
import { ConditionCase } from '~/components/agents/procedures/nodes/condition-case-node'
import { ConditionElse } from '~/components/agents/procedures/nodes/condition-else-node'
import { ConditionPredicate } from '~/components/agents/procedures/nodes/condition-predicate-node'
import {
  allowsConditions,
  allowsContainers,
  allowsTable,
  DEFAULT_BLOCKS,
  docContentExpr,
  type EditorBlock,
} from '../blocks/allowed-blocks'
import { Table, TableCell, TableHeader, TableRow } from '../extensions/table'
import {
  createPlaceholderNode,
  PlaceholderBadge,
  stableStringify,
  useExternalContentSync,
  type useSlashCommand,
} from '../inline-picker'
import type { ReferenceTab } from '../inline-picker/nodes/reference-picker-node'
import { Accordion } from '../kb-article/accordion-node'
import { Block } from '../kb-article/block-node'
import { MarkdownInputRules } from '../kb-article/markdown-input-rules'
import { MarkdownPaste } from '../kb-article/markdown-paste'
import { migrateLegacyContent } from '../kb-article/migrate-legacy-content'
import { Panel } from '../kb-article/panel-node'
import { Tabs } from '../kb-article/tabs-node'
import { procedureLineNumberFormatter, procedureNumberPolicy } from './outline-numbering'
import { buildReferencePickerExtensions } from './reference-picker-extensions'

// The `doc` content union is derived from the surface's allowed block set (see
// `docContentExpr`). A group token (`containerBlock` / `procedureBlock`) is only
// valid when ≥1 member node is mounted, so each is included only when the
// corresponding nodes are allowed below.
function createDoc(allowedBlocks: EditorBlock[]) {
  return Node.create({
    name: 'doc',
    topNode: true,
    content: docContentExpr(allowedBlocks),
  })
}

const FocusClasses = Extension.create({
  name: 'focus-classes',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('focus-classes'),
        props: {
          decorations: ({ doc, selection }) => {
            const decorations: Decoration[] = []
            doc.descendants((node, pos) => {
              if (node.isBlock && pos <= selection.from && pos + node.nodeSize >= selection.to) {
                decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'has-focus' }))
              }
              return true
            })
            return DecorationSet.create(doc, decorations)
          },
        },
      }),
    ]
  },
})

const emptyBody: JSONContent[] = [{ type: 'block', attrs: { blockType: 'text' }, content: [] }]

export interface UseRichTextEditorOptions {
  initialContent: JSONContent[] | null
  /**
   * Fired on every doc change. `html` is a LAZY getter — TipTap's HTML
   * serialization is skipped unless a consumer actually calls it (only KB's
   * article autosave does). Procedure / persona surfaces read `json` only, so
   * they never pay the per-keystroke serialize cost.
   */
  onChange: (content: { json: JSONContent; getHTML: () => string }) => void
  /**
   * Optional slash-command bundle from `useSlashCommand()`. When set, mounts
   * the slash extension and wires open-state guards into onUpdate so typing
   * inside the slash picker doesn't fire onChange.
   */
  slashCommand?: ReturnType<typeof useSlashCommand>
  /**
   * Default `true`. When set, mounts the `@`-mention picker extensions
   * (referenceBadgeNode + ReferencePickerNode). The consumer mounts the
   * popover separately via `useActivePicker(editor)` + `InlinePickerPopover`.
   */
  enableReferencePicker?: boolean
  /** Forwarded to the reference picker chip. */
  onPickerEnter?: () => boolean
  /** Forwarded to the reference picker chip. */
  onPickerArrowVertical?: (direction: 1 | -1) => boolean
  /**
   * Tabs the reference picker exposes. Defaults to `DEFAULT_TABS`. Pass
   * `[...DEFAULT_TABS, 'tools']` on admin-facing surfaces (persona editor)
   * to opt into the Tools tab. The matching `<ReferencePickerContent>` mount
   * must be passed the same list.
   */
  referenceTabs?: ReferenceTab[]
  /**
   * Forwarded to TipTap's `useEditor({ editable })`. Defaults to `true`.
   * When `false`, the editor renders its content with the same block / badge
   * extensions but disables typing — used for read-only previews (system
   * template gallery, etc.).
   */
  editable?: boolean
  /**
   * Overrides the default-branch placeholder rendered inside an empty text
   * `Block`. Heading and table-cell branches still use their own placeholders.
   * Defaults to `"Press '/' for commands"`.
   */
  placeholderText?: string
  /**
   * Extra Tiptap extensions to mount alongside the standard ones (e.g. the
   * workflow `{`-variable picker). Spread into the extensions array after
   * the reference-picker extensions. Defaults to `[]`.
   */
  inlineExtensions?: Extension[]
  /**
   * The block kinds this editor exposes — the single source of truth for the
   * schema (which separate nodes mount), markdown rules/paste, and the bubble
   * "Turn into" menu. Defaults to {@link DEFAULT_BLOCKS} (the full KB set).
   * Spread a preset: `KB_BLOCKS`, `PERSONA_BLOCKS`, `PROCEDURE_BLOCKS`.
   * `conditionBlock` in the set mounts the v9 procedure control-flow nodes
   * (replacing the old `enableProcedureNodes` flag).
   */
  allowedBlocks?: EditorBlock[]
  /**
   * When `true`, the gutter line numbers are visible at rest instead of fading
   * in only on hover/focus. Adds a class to the `.ProseMirror` root that flips
   * the resting opacity custom property; every existing hover / focus / drag
   * rule keeps working on top. Defaults to `false` (today's behavior). Opt-in
   * the same way as a procedure block set — used by the procedure editor.
   */
  alwaysShowLineNumbers?: boolean
}

/**
 * Generic rich-text editor hook for the KB block schema. Used by:
 * - `useKBArticleEditor` (thin shim — adds KB-specific picker / link popover)
 * - `PersonaEditor` (agent persona prompt, no slash menu)
 *
 * Mounts StarterKit + the `block` node, the markdown input/paste rules, the
 * focus decoration plugin, and — by default — the inline reference picker.
 * The separate structural nodes (Panel / Tabs / Accordion / Table / procedure
 * condition nodes) mount only when their kind is in `allowedBlocks`. Slash
 * command is opt-in.
 */
export function useRichTextEditor({
  initialContent,
  onChange,
  slashCommand,
  enableReferencePicker = true,
  onPickerEnter,
  onPickerArrowVertical,
  referenceTabs,
  editable = true,
  placeholderText,
  inlineExtensions,
  allowedBlocks = DEFAULT_BLOCKS,
  alwaysShowLineNumbers = false,
}: UseRichTextEditorOptions) {
  const normalizedInitialContent = useMemo<JSONContent>(() => {
    const migrated = migrateLegacyContent(initialContent)
    const content = migrated && migrated.length > 0 ? migrated : emptyBody
    return { type: 'doc', content }
  }, [initialContent])

  const placeholderNodeExtension = useMemo(
    () => createPlaceholderNode((p) => <PlaceholderBadge {...p} />),
    []
  )

  const referencePickerExtensions = useMemo(
    () =>
      enableReferencePicker
        ? buildReferencePickerExtensions({
            onPickerEnter,
            onPickerArrowVertical,
            referenceTabs,
          })
        : [],
    [enableReferencePicker, onPickerEnter, onPickerArrowVertical, referenceTabs]
  )

  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const externalSyncRef = useRef<{ markLocalEdit: (key: string) => void }>({
    markLocalEdit: () => {},
  })

  const slashCommandRef = useRef(slashCommand)
  slashCommandRef.current = slashCommand

  // Presentation classes on the `.ProseMirror` root — each flips a CSS custom
  // property consumed by the block renderer. Set on the root (not a wrapper) so
  // they reach blocks in both the inline card and the portaled expand dialog.
  const rootClass = [
    alwaysShowLineNumbers && 'alwaysShowLineNumbers', // resting line-number opacity
    allowsConditions(allowedBlocks) && 'procedureBlockSpacing', // per-step vertical rhythm
  ]
    .filter(Boolean)
    .join(' ')

  const editor = useEditor(
    {
      immediatelyRender: false,
      editable,
      ...(rootClass ? { editorProps: { attributes: { class: rootClass } } } : {}),
      extensions: [
        createDoc(allowedBlocks),
        StarterKit.configure({
          document: false,
          heading: false,
          paragraph: false,
          bulletList: false,
          orderedList: false,
          listItem: false,
          blockquote: false,
          codeBlock: false,
          horizontalRule: false,
          history: undefined,
          // Marks stay enabled (bold, italic, strike, code).
        }),
        // Hierarchical gutter numbering rides on the same `conditionBlock`
        // opt-in as the procedure nodes; every other surface keeps the default
        // flat formatter (set in BlockOptions). placeholderText merges in too.
        Block.configure({
          ...(placeholderText ? { placeholderText } : {}),
          ...(allowsConditions(allowedBlocks)
            ? {
                lineNumberFormatter: procedureLineNumberFormatter,
                numberPolicy: procedureNumberPolicy,
              }
            : {}),
        }),
        // Container nodes (Panel/Tabs/Accordion) and Table are separate PM
        // nodes — mounting them is the enforcement. Not in `allowedBlocks` →
        // not in the schema → unreachable from paste / drag / programmatic.
        // Panel is the child of Tabs/Accordion, so it rides along whenever any
        // container is allowed.
        ...(allowsContainers(allowedBlocks) ? [Panel, Tabs, Accordion] : []),
        MarkdownInputRules.configure({ allowed: allowedBlocks }),
        MarkdownPaste.configure({ allowed: allowedBlocks }),
        // Column resizing is disabled — the React NodeView (TableNodeView)
        // owns the table chrome and column resize is a follow-up. Reorder +
        // add/remove are handled via table-helpers.ts.
        ...(allowsTable(allowedBlocks) ? [Table, TableRow, TableHeader, TableCell] : []),
        Underline,
        TextStyle,
        Color,
        TextAlign.configure({ types: ['block'] }),
        Highlight.configure({ multicolor: true }),
        Link.configure({ openOnClick: false, autolink: true, defaultProtocol: 'https' }),
        FocusClasses,
        // Placeholder renders as a real DOM sibling inside BlockNodeView, not
        // via the Placeholder extension's CSS pseudo-element (which would
        // overlap the line gutter). See block-node-view.tsx `showPlaceholder`.
        ...(slashCommand ? [slashCommand.slashCommandExtension] : []),
        ...(allowsConditions(allowedBlocks)
          ? [ConditionBlock, ConditionCase, ConditionElse, ConditionPredicate]
          : []),
        ...referencePickerExtensions,
        ...(inlineExtensions ?? []),
        placeholderNodeExtension,
      ],
      content: normalizedInitialContent,
      shouldRerenderOnTransaction: false,
      onCreate: ({ editor }) => {
        slashCommandRef.current?.setEditor(editor)
      },
      onDestroy: () => {
        slashCommandRef.current?.setEditor(null)
      },
      onUpdate: ({ editor, transaction }) => {
        if (!transaction.docChanged) return
        if (slashCommandRef.current?.isOpenRef.current) return
        const json = editor.getJSON()
        // Defer one tick so Suggestion plugin's onStart can mark isOpenRef
        // before we propagate the change.
        setTimeout(() => {
          if (slashCommandRef.current?.isOpenRef.current) return
          externalSyncRef.current.markLocalEdit(stableStringify(json))
          onChangeRef.current({ json, getHTML: () => editor.getHTML() })
        }, 0)
      },
    },
    []
  )

  // `useEditor` is created once with `editable` from the first render. Sync
  // subsequent toggles via `setEditable` so a "View ↔ Customize" swap on the
  // same editor instance flips read-only state without remounting.
  useEffect(() => {
    if (!editor) return
    if (editor.isEditable !== editable) editor.setEditable(editable)
  }, [editor, editable])

  const gutterCharWidth = useEditorState({
    editor,
    selector: ({ editor }) =>
      editor ? Math.max(2, String(editor.state.doc.content.childCount).length) : 2,
  })

  const applyContent = useCallback((instance: NonNullable<typeof editor>, content: JSONContent) => {
    // Skip when the editor is already at the incoming doc — happens on
    // mount because `useEditor` initialized it with the same content, and
    // a redundant `setContent` here triggers TipTap's React node views to
    // flushSync mid-commit ("flushSync was called from inside a lifecycle
    // method" warning). Uses stableStringify so server-side JSONB key
    // reordering doesn't make a same-content doc look different.
    if (stableStringify(instance.getJSON()) === stableStringify(content)) return
    const { from, to } = instance.state.selection
    instance.commands.setContent(content, false)
    try {
      instance.commands.setTextSelection({ from, to })
    } catch {
      instance.commands.focus('end')
    }
  }, [])

  const canonicalKey = useCallback((content: JSONContent) => stableStringify(content), [])

  const syncHandle = useExternalContentSync<JSONContent>({
    editor,
    incoming: normalizedInitialContent,
    isPickerOpen: slashCommand?.suggestionState.isOpen ?? false,
    applyContent,
    canonicalKey,
  })

  // Wire the imperative handle into the editor's onUpdate closure.
  externalSyncRef.current = syncHandle.current

  // Flush deferred onChange when the slash picker closes — the hook handles
  // the *inbound* flush; this handles the *outbound* one.
  const prevOpen = useRef(false)
  useEffect(() => {
    const isOpen = slashCommand?.suggestionState.isOpen ?? false
    if (prevOpen.current && !isOpen && editor) {
      onChangeRef.current({ json: editor.getJSON(), getHTML: () => editor.getHTML() })
    }
    prevOpen.current = isOpen
  }, [slashCommand?.suggestionState.isOpen, editor])

  return { editor, gutterCharWidth: gutterCharWidth ?? 2 }
}
