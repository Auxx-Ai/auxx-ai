// apps/web/src/components/editor/inline-picker/nodes/reference-picker-node.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { InputRule, mergeAttributes, Node } from '@tiptap/core'
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import {
  NodeViewContent,
  type NodeViewProps,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from '@tiptap/react'
import { AtSign } from 'lucide-react'
import { useEffect, useReducer } from 'react'

export const REFERENCE_PICKER_NODE = 'referencePicker'

/**
 * Zero-width space seeded inside a freshly-opened chip so ProseMirror has a
 * real DOM text node to anchor `beforeinput` events on. Without it, an empty
 * `text*` inline node silently drops keystrokes because the browser can't
 * place a text cursor in "nothing." We strip this from `textContent` reads
 * before exposing the chip's query to the picker UI.
 */
const ZWSP = '​'

/** Strip the leading seed ZWSP from a picker chip's text content. */
function pickerQueryText(node: import('@tiptap/pm/model').Node): string {
  return node.textContent.replace(/​/g, '')
}

export type ReferenceTab = 'people' | 'records' | 'messages' | 'articles' | 'tools'

/**
 * Default tab set rendered by `@`-pickers. Opt-in tabs (currently just
 * `'tools'`) are NOT included here — they ship only in admin-facing surfaces
 * that explicitly pass `tabs: [...DEFAULT_TABS, 'tools']`. Opt-in defaults
 * keep tabs like `tools` from accidentally appearing in customer-facing
 * editors (mail composer, KB articles).
 */
export const DEFAULT_TABS: ReferenceTab[] = ['people', 'records', 'messages', 'articles']

export const TAB_LABEL: Record<ReferenceTab, string> = {
  people: 'People',
  records: 'Records',
  messages: 'Messages',
  articles: 'Articles',
  tools: 'Tools',
}

/** Resolve digit (1–9) → tab from the configured tab list. */
function digitToTab(digit: string, tabs: readonly ReferenceTab[]): ReferenceTab | null {
  const idx = Number.parseInt(digit, 10)
  if (!Number.isFinite(idx) || idx < 1 || idx > tabs.length) return null
  return tabs[idx - 1] ?? null
}

const pickerPluginKey = new PluginKey('reference-picker-keys')

interface ReferencePickerOptions {
  /**
   * Called when Enter is pressed inside the chip. The handler decides whether
   * to confirm a selection (in which case it should return true) or fall
   * through (false). The picker UI is responsible for tracking the active
   * highlight and dispatching `confirmPicker` on the editor.
   */
  onEnter?: () => boolean
  /**
   * Called when ArrowUp/ArrowDown is pressed inside the chip. Returning true
   * stops the event so it doesn't move the document cursor.
   */
  onArrowVertical?: (direction: 1 | -1) => boolean
  /**
   * Tabs this picker exposes. Drives the initial chip tab, digit shortcuts
   * (1–N), and Tab/Shift+Tab cycling. The popover (`ReferencePickerContent`)
   * must be passed the same list — they're paired but not auto-synced
   * because the popover lives in React and this node lives in ProseMirror.
   * Defaults to `DEFAULT_TABS`.
   */
  tabs?: ReferenceTab[]
}

function findPickerNode(state: import('@tiptap/pm/state').EditorState) {
  let found: { pos: number; node: import('@tiptap/pm/model').Node } | null = null
  state.doc.descendants((node, pos) => {
    if (node.type.name === REFERENCE_PICKER_NODE) {
      found = { pos, node }
      return false
    }
    return undefined
  })
  return found
}

function ReferencePickerNodeView({ selected, editor, getPos }: NodeViewProps) {
  // TipTap's React node view does NOT re-render on content changes (only attrs
  // / selection). Force a re-render on every transaction so we can read the
  // chip's live content size out of editor.state.doc each pass.
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    editor.on('transaction', forceUpdate)
    return () => {
      editor.off('transaction', forceUpdate)
    }
  }, [editor])

  // Resolve current attrs + content from the live doc, not the (stale) `node`
  // prop. On first mount the node is freshly created — empty + default tab.
  const pos = typeof getPos === 'function' ? getPos() : null
  const liveNode = typeof pos === 'number' ? editor.state.doc.nodeAt(pos) : null
  const isCurrentPicker = liveNode?.type.name === REFERENCE_PICKER_NODE
  const tab = (isCurrentPicker ? (liveNode.attrs.tab ?? 'people') : 'people') as ReferenceTab
  const isEmpty = !isCurrentPicker || pickerQueryText(liveNode).length === 0

  const handleTabClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const pos = getPos?.()
    if (typeof pos !== 'number') return
    // Toggle node-selection on the chip so digits switch tabs
    editor
      .chain()
      .command(({ tr }) => {
        tr.setSelection(NodeSelection.create(tr.doc, pos))
        return true
      })
      .focus()
      .run()
  }

  return (
    <NodeViewWrapper
      as='span'
      data-type='reference-picker'
      data-tab={tab}
      data-selected={selected ? 'true' : undefined}
      className={cn(
        'inline-flex items-center gap-0.5 align-baseline rounded-md px-1 py-0 text-sm',
        'bg-primary-100 text-primary-700 ring-1 ring-primary-200',
        selected && 'ring-primary-400'
      )}>
      <AtSign className='size-3 shrink-0 opacity-70' />
      <button
        type='button'
        tabIndex={-1}
        contentEditable={false}
        onMouseDown={handleTabClick}
        className={cn(
          'shrink-0 rounded-sm px-1 text-[10px] font-medium uppercase tracking-wide leading-4',
          'bg-primary-200/60 text-primary-800',
          selected && 'bg-primary-300 text-primary-900'
        )}
        title={`${TAB_LABEL[tab]} — press 1–4 or click to change`}>
        {TAB_LABEL[tab]}
      </button>
      {/*
       * Placeholder is a React-controlled absolutely-positioned sibling, not
       * a CSS `:before`. The global `.ProseMirror .is-empty::before` rule in
       * prosemirror.css fights the Tailwind arbitrary `data-[empty]:before`
       * approach, and the ZWSP seed means `:empty` selectors don't match
       * either. Owning the placeholder in React sidesteps all of that.
       */}
      <span className='relative inline-flex items-baseline'>
        {isEmpty && (
          <span
            contentEditable={false}
            aria-hidden='true'
            className='pointer-events-none absolute left-0 top-0 select-none whitespace-nowrap text-muted-foreground/60'>
            Search…
          </span>
        )}
        <NodeViewContent
          as='span'
          data-slot='reference-picker-query'
          className='inline-block min-w-[1ch] outline-none'
        />
      </span>
    </NodeViewWrapper>
  )
}

/**
 * Inline TipTap node for the in-progress `@` mention picker chip.
 *
 * The chip is **transient** — it represents an open picker. On selection it
 * collapses into a `reference` badge node (the persisted form); on
 * cancel/blur-with-empty it collapses to nothing or plain text.
 *
 * Schema: `content: 'text*'` so ProseMirror owns the cursor + selection
 * inside the search hole. Spaces, IME, undo, etc. all Just Work.
 */
export const ReferencePickerNode = Node.create<ReferencePickerOptions>({
  name: REFERENCE_PICKER_NODE,
  group: 'inline',
  inline: true,
  atom: false,
  selectable: true,
  draggable: false,
  content: 'text*',
  marks: '',
  defining: true,
  isolating: true,

  addOptions() {
    return {
      onEnter: undefined,
      onArrowVertical: undefined,
      tabs: DEFAULT_TABS,
    }
  },

  addAttributes() {
    return {
      tab: {
        default: 'people' as ReferenceTab,
        parseHTML: (el) => (el.getAttribute('data-tab') as ReferenceTab) ?? 'people',
        renderHTML: (attrs) => ({ 'data-tab': attrs.tab }),
      },
    }
  },

  parseHTML() {
    return [{ tag: `span[data-type="${REFERENCE_PICKER_NODE}"]` }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': REFERENCE_PICKER_NODE }), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ReferencePickerNodeView)
  },

  addInputRules() {
    const options = this.options
    return [
      new InputRule({
        // `@` at start-of-block or after whitespace. Capture preceding char so
        // we know how much to delete.
        find: /(^|\s)@$/,
        handler: ({ state, range, match }) => {
          // The InputRule shares the plugin's pending transaction via
          // `state.tr` (createChainableState wraps it). Mutating `state.tr`
          // is how we tell the plugin to commit our changes instead of the
          // default text insert.
          //
          // IMPORTANT: do NOT `return null` — the plugin treats a null return
          // as "abort, don't dispatch", even when tr has steps. Returning
          // `undefined` (no return) lets the plugin dispatch the mutated tr.
          if (findPickerNode(state)) return

          const nodeType = state.schema.nodes[REFERENCE_PICKER_NODE]
          if (!nodeType) return

          // For `@` after whitespace, the match starts at the whitespace; for
          // `@` at start-of-block, the match starts at the `@` itself. Keep
          // any preceding whitespace untouched.
          const prefixLen = match[1]?.length ?? 0
          const atFrom = range.from + prefixLen
          const atTo = range.to

          const tr = state.tr
          // Seed the chip with a zero-width space so PM has a real DOM text
          // node for the browser's caret to anchor on. Without this, an empty
          // `text*` inline node accepts the cursor *positionally* but the
          // browser produces no `beforeinput` events when the user types →
          // PM never dispatches a textInput transaction → keystrokes are
          // silently dropped (confirmed via diagnostic logs).
          const initialTab = options.tabs?.[0] ?? 'people'
          const node = nodeType.create({ tab: initialTab }, state.schema.text(ZWSP))
          tr.replaceRangeWith(atFrom, atTo, node)
          // Place the cursor after the seed ZWSP (inside the chip, offset 2:
          // 1 to enter the chip + 1 to skip the ZWSP).
          tr.setSelection(TextSelection.create(tr.doc, atFrom + 2))
        },
      }),
    ]
  },

  addCommands() {
    return {
      /**
       * Replace the current open picker chip with a `reference` badge node
       * holding `recordId`, followed by a space.
       */
      confirmReferencePicker:
        (recordId: string) =>
        ({ state, chain }) => {
          const picker = findPickerNode(state)
          if (!picker) return false
          const referenceType = state.schema.nodes.reference
          if (!referenceType) return false
          const from = picker.pos
          const to = picker.pos + picker.node.nodeSize
          chain()
            .command(({ tr }) => {
              tr.replaceRangeWith(from, to, referenceType.create({ id: recordId }))
              return true
            })
            .insertContent(' ')
            .focus()
            .run()
          return true
        },
      /**
       * Remove the open picker chip. If `keepText` is true, replace it with
       * plain `@<query>` so typing context isn't lost (used by Escape).
       */
      closeReferencePicker:
        (opts?: { keepText?: boolean }) =>
        ({ state, chain }) => {
          const picker = findPickerNode(state)
          if (!picker) return false
          const from = picker.pos
          const to = picker.pos + picker.node.nodeSize
          if (opts?.keepText) {
            const text = pickerQueryText(picker.node)
            const replacement = `@${text}`
            chain()
              .command(({ tr }) => {
                tr.replaceRangeWith(from, to, state.schema.text(replacement))
                tr.setSelection(TextSelection.create(tr.doc, from + replacement.length))
                return true
              })
              .focus()
              .run()
          } else {
            chain()
              .command(({ tr }) => {
                tr.delete(from, to)
                return true
              })
              .focus()
              .run()
          }
          return true
        },
      /** Set the active tab on the open picker chip. */
      setReferencePickerTab:
        (tab: ReferenceTab) =>
        ({ state, chain }) => {
          const picker = findPickerNode(state)
          if (!picker) return false
          chain()
            .command(({ tr }) => {
              tr.setNodeMarkup(picker.pos, undefined, { ...picker.node.attrs, tab })
              return true
            })
            .run()
          return true
        },
    } as Partial<import('@tiptap/core').RawCommands>
  },

  addProseMirrorPlugins() {
    const options = this.options
    return [
      new Plugin({
        key: pickerPluginKey,
        // Disallow more than one open picker chip in the doc.
        filterTransaction(transaction, state) {
          if (!transaction.docChanged) return true
          let pickerCount = 0
          transaction.doc.descendants((node) => {
            if (node.type.name === REFERENCE_PICKER_NODE) pickerCount++
            return pickerCount < 2
          })
          if (pickerCount > 1) {
            // Reject — keep prior state.
            void state
            return false
          }
          return true
        },
        props: {
          handleKeyDown(view, event) {
            const { state } = view
            const { selection } = state

            // Resolve picker context: cursor inside it OR node selected on it.
            const nodeSel =
              selection instanceof NodeSelection &&
              selection.node.type.name === REFERENCE_PICKER_NODE
                ? selection
                : null

            let pickerPos: number | null = null
            let pickerNode: import('@tiptap/pm/model').Node | null = null
            let isNodeSelected = false
            let parentOffset = 0
            let parentContentSize = 0

            if (nodeSel) {
              pickerPos = nodeSel.from
              pickerNode = nodeSel.node
              isNodeSelected = true
            } else {
              const $from = state.selection.$from
              for (let d = $from.depth; d >= 0; d--) {
                const ancestor = $from.node(d)
                if (ancestor.type.name === REFERENCE_PICKER_NODE) {
                  pickerPos = $from.before(d)
                  pickerNode = ancestor
                  parentOffset = $from.parentOffset
                  parentContentSize = ancestor.content.size
                  break
                }
              }
            }

            if (pickerPos === null || !pickerNode) return false

            const chipFrom = pickerPos
            const chipTo = pickerPos + pickerNode.nodeSize
            const contentStart = pickerPos + 1

            // Real user-visible query (ZWSP seed stripped).
            const realQuery = pickerQueryText(pickerNode)
            const realQueryLen = realQuery.length

            // --- Escape: collapse to plain `@<query>` text ---
            if (event.key === 'Escape') {
              event.preventDefault()
              const replacement = realQuery ? `@${realQuery}` : ''
              const tr = state.tr
              if (replacement) {
                tr.replaceRangeWith(chipFrom, chipTo, state.schema.text(replacement))
                tr.setSelection(TextSelection.create(tr.doc, chipFrom + replacement.length))
              } else {
                tr.delete(chipFrom, chipTo)
              }
              view.dispatch(tr)
              return true
            }

            // --- Enter: hand to consumer (selection of highlighted item) ---
            if (event.key === 'Enter') {
              if (options.onEnter?.()) {
                event.preventDefault()
                return true
              }
              // No handler / nothing highlighted: fall through to default (which
              // for inline content inserts a line break — suppress that here).
              event.preventDefault()
              return true
            }

            // --- ArrowUp / ArrowDown: forward to list nav ---
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              const dir = event.key === 'ArrowDown' ? 1 : -1
              if (options.onArrowVertical?.(dir)) {
                event.preventDefault()
                return true
              }
              return false
            }

            // --- ArrowLeft ---
            if (event.key === 'ArrowLeft') {
              if (isNodeSelected) {
                // Exit chip leftward
                const tr = state.tr.setSelection(TextSelection.create(state.doc, chipFrom))
                view.dispatch(tr.scrollIntoView())
                return true
              }
              // Effective content start sits AFTER the seed ZWSP — don't let
              // the user park the cursor before it.
              const hasZwsp = pickerNode.textContent.startsWith(ZWSP)
              const effectiveStart = hasZwsp ? 1 : 0
              if (parentOffset <= effectiveStart) {
                const tr = state.tr.setSelection(NodeSelection.create(state.doc, chipFrom))
                view.dispatch(tr.scrollIntoView())
                return true
              }
              return false
            }

            // --- ArrowRight ---
            if (event.key === 'ArrowRight') {
              if (isNodeSelected) {
                // Enter the chip from the badge
                const tr = state.tr.setSelection(TextSelection.create(state.doc, contentStart))
                view.dispatch(tr.scrollIntoView())
                return true
              }
              if (parentOffset === parentContentSize) {
                // At content end → exit chip rightward
                const tr = state.tr.setSelection(TextSelection.create(state.doc, chipTo))
                view.dispatch(tr.scrollIntoView())
                return true
              }
              return false
            }

            // --- Backspace ---
            if (event.key === 'Backspace') {
              if (isNodeSelected) {
                // Delete the chip entirely
                const tr = state.tr.delete(chipFrom, chipTo)
                view.dispatch(tr.scrollIntoView())
                return true
              }
              if (realQueryLen === 0) {
                // Chip holds only the seed ZWSP (or is genuinely empty) →
                // backspace closes the chip in one press.
                const tr = state.tr.delete(chipFrom, chipTo)
                view.dispatch(tr.scrollIntoView())
                return true
              }
              return false
            }

            // --- Digit 1–N: tab quick-access (where N = configured tabs) ---
            const tabs = options.tabs ?? DEFAULT_TABS
            const digitTab = digitToTab(event.key, tabs)
            if (digitTab) {
              const canSwitch = isNodeSelected || realQueryLen === 0
              if (canSwitch) {
                event.preventDefault()
                const tr = state.tr.setNodeMarkup(chipFrom, undefined, {
                  ...pickerNode.attrs,
                  tab: digitTab,
                })
                // Land cursor inside (after the seed ZWSP if present).
                const hasZwsp = pickerNode.textContent.startsWith(ZWSP)
                tr.setSelection(TextSelection.create(tr.doc, chipFrom + 1 + (hasZwsp ? 1 : 0)))
                view.dispatch(tr)
                return true
              }
            }

            // --- Tab / Shift+Tab: cycle tabs ---
            if (event.key === 'Tab') {
              event.preventDefault()
              const currentTab = (pickerNode.attrs.tab ?? tabs[0] ?? 'people') as ReferenceTab
              const idx = Math.max(0, tabs.indexOf(currentTab))
              const dir = event.shiftKey ? -1 : 1
              const next = tabs[(idx + dir + tabs.length) % tabs.length]!
              const tr = state.tr.setNodeMarkup(chipFrom, undefined, {
                ...pickerNode.attrs,
                tab: next,
              })
              view.dispatch(tr)
              return true
            }

            return false
          },
        },
      }),
    ]
  },
})

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    referencePicker: {
      confirmReferencePicker: (recordId: string) => ReturnType
      closeReferencePicker: (opts?: { keepText?: boolean }) => ReturnType
      setReferencePickerTab: (tab: ReferenceTab) => ReturnType
    }
  }
}
