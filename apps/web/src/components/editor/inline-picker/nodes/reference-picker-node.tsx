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
import { AtSign, Braces, Slash } from 'lucide-react'
import { useEffect, useReducer } from 'react'

export const REFERENCE_PICKER_NODE = 'referencePicker'

/** The characters that can open a picker chip. */
export type PickerTrigger = '@' | '/' | '{'

/**
 * One configured trigger on the chip node. `kind` drives keyboard behavior:
 * `'mention'` = tabs + digit shortcuts (the `@` picker); `'command'` = drill
 * + list nav (the `/` and `{` pickers). `allowedPrefixes` controls where the
 * trigger may fire: `null` = anywhere (mid-word, e.g. `Hi {name}`); anything
 * else = start-of-block or after whitespace (the default for `@`/`/`).
 */
export interface TriggerConfig {
  char: PickerTrigger
  kind: 'mention' | 'command'
  allowedPrefixes?: string[] | null
}

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

export type ReferenceTab =
  | 'people'
  | 'records'
  | 'messages'
  | 'articles'
  | 'tools'
  | 'resources'
  | 'fields'

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
  resources: 'Resources',
  fields: 'Fields',
}

/** Resolve digit (1–9) → tab from the configured tab list. */
function digitToTab(digit: string, tabs: readonly ReferenceTab[]): ReferenceTab | null {
  const idx = Number.parseInt(digit, 10)
  if (!Number.isFinite(idx) || idx < 1 || idx > tabs.length) return null
  return tabs[idx - 1] ?? null
}

const pickerPluginKey = new PluginKey('reference-picker-keys')

/**
 * Resolve the effective trigger set. An explicit `triggers` option wins;
 * otherwise fall back to the `mention`/`slash` sugar so existing consumers
 * (persona / KB / procedures / mail) need no changes.
 */
function resolveTriggers(options: ReferencePickerOptions): TriggerConfig[] {
  if (options.triggers && options.triggers.length > 0) return options.triggers
  const out: TriggerConfig[] = []
  if (options.mention !== false) out.push({ char: '@', kind: 'mention' })
  if (options.slash) out.push({ char: '/', kind: 'command' })
  return out
}

/** Keyboard behavior for a trigger char, resolved from the configured set. */
function kindForTrigger(
  options: ReferencePickerOptions,
  trigger: PickerTrigger
): 'mention' | 'command' {
  const cfg = resolveTriggers(options).find((t) => t.char === trigger)
  if (cfg) return cfg.kind
  return trigger === '@' ? 'mention' : 'command'
}

interface ReferencePickerOptions {
  /**
   * Called when Enter is pressed inside an `@` chip. The handler decides
   * whether to confirm a selection (in which case it should return true) or
   * fall through (false). The picker UI is responsible for tracking the
   * active highlight and dispatching `confirmReferencePicker` on the editor.
   */
  onEnter?: () => boolean
  /**
   * Called when ArrowUp/ArrowDown is pressed inside an `@` chip. Returning
   * true stops the event so it doesn't move the document cursor.
   */
  onArrowVertical?: (direction: 1 | -1) => boolean
  /**
   * Tabs the `@` picker exposes. Drives the initial chip tab, digit shortcuts
   * (1–N), and Tab/Shift+Tab cycling. The popover (`ReferencePickerContent`)
   * must be passed the same list — they're paired but not auto-synced
   * because the popover lives in React and this node lives in ProseMirror.
   * Defaults to `DEFAULT_TABS`.
   */
  tabs?: ReferenceTab[]
  /**
   * Mount the `@` mention trigger. Defaults to `true` — disable on surfaces
   * that want `/`-only (e.g. the mail composer) so typing `@` inserts a
   * literal character instead of opening a dead mention chip.
   */
  mention?: boolean
  /**
   * Mount the `/` trigger. The same chip node then also opens for slash
   * commands: `trigger: '/'`, `tab` holds the drill scope label (null = root).
   */
  slash?: boolean
  /**
   * Explicit trigger set. When provided, overrides the `mention`/`slash`
   * sugar entirely — use it for non-default triggers (e.g. a mid-word `{`
   * placeholder picker). Each entry's `kind` selects the keyboard behavior
   * and `allowedPrefixes` controls where it fires (see `TriggerConfig`).
   */
  triggers?: TriggerConfig[]
  /** Enter inside a `/` chip — confirm the highlighted slash item. */
  onSlashEnter?: () => boolean
  /** ArrowUp/Down inside a `/` chip — move the slash list highlight. */
  onSlashArrowVertical?: (direction: 1 | -1) => boolean
  /**
   * Backspace or ArrowLeft on an EMPTY, drilled `/` chip (`tab !== null`).
   * Return true if a drill level was popped (the popover owns the drill
   * stack); false falls through (Backspace deletes the chip, ArrowLeft moves
   * the caret).
   */
  onSlashBackspacePop?: () => boolean
  /**
   * ArrowRight inside a `/` chip — drill into the highlighted slash item if
   * it's drillable. Return true to consume the key (drill-first: takes
   * priority over caret movement); false falls through to caret movement.
   */
  onSlashArrowRight?: () => boolean
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

/**
 * Range covering the currently-open picker chip, or null. Slash executors
 * receive this range and `deleteRange(range)` it inside their own chain so
 * chip removal + the command's edit land in ONE transaction (one undo step).
 */
export function getOpenPickerRange(
  state: import('@tiptap/pm/state').EditorState
): { from: number; to: number } | null {
  const picker = findPickerNode(state)
  return picker ? { from: picker.pos, to: picker.pos + picker.node.nodeSize } : null
}

/** True when the resolved position sits inside a code block. */
function insideCodeBlock($pos: import('@tiptap/pm/model').ResolvedPos): boolean {
  for (let d = $pos.depth; d >= 0; d--) {
    const node = $pos.node(d)
    if (node.type.name === 'block' && node.attrs.blockType === 'codeBlock') return true
    if (node.type.name === 'codeBlock') return true
  }
  return false
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
  const trigger = (isCurrentPicker ? (liveNode.attrs.trigger ?? '@') : '@') as PickerTrigger
  const scope = (isCurrentPicker ? (liveNode.attrs.tab ?? null) : null) as string | null
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

  // Sublabel: `@` chips always show the active tab; `/` chips show the drill
  // scope only once drilled (root renders symbol + query alone).
  const sublabel = trigger === '@' ? (TAB_LABEL[scope as ReferenceTab] ?? scope ?? 'People') : scope

  return (
    <NodeViewWrapper
      as='span'
      data-type='reference-picker'
      data-trigger={trigger}
      data-tab={scope ?? undefined}
      data-selected={selected ? 'true' : undefined}
      className={cn(
        'inline-flex items-center gap-0.5 align-baseline rounded-md px-1 py-0 text-sm',
        'bg-primary-100 text-primary-700 ring-1 ring-primary-200',
        selected && 'ring-primary-400'
      )}>
      {trigger === '@' ? (
        <AtSign className='size-3 shrink-0 opacity-70' />
      ) : trigger === '{' ? (
        <Braces className='size-3 shrink-0 opacity-70' />
      ) : (
        <Slash className='size-3 shrink-0 opacity-70' />
      )}
      {sublabel && (
        <button
          type='button'
          tabIndex={-1}
          contentEditable={false}
          onMouseDown={trigger === '@' ? handleTabClick : (e) => e.preventDefault()}
          className={cn(
            'shrink-0 rounded-sm px-1 text-[10px] font-medium uppercase tracking-wide leading-4',
            'bg-primary-200/60 text-primary-800',
            selected && 'bg-primary-300 text-primary-900'
          )}
          title={trigger === '@' ? `${sublabel} — press 1–4 or click to change` : sublabel}>
          {sublabel}
        </button>
      )}
      {/*
       * Placeholder is a React-controlled sibling, not a CSS `:before`. The
       * global `.ProseMirror .is-empty::before` rule in prosemirror.css fights
       * the Tailwind arbitrary `data-[empty]:before` approach, and the ZWSP
       * seed means `:empty` selectors don't match either.
       *
       * Layout: a 1x1 inline grid stacks the placeholder and NodeViewContent
       * in the same cell — the wider child drives the track size, so the chip
       * pill expands to fit "Search…" when empty and shrinks to the typed
       * query once the user types. Prior absolute positioning collapsed the
       * containing block to 1ch and the inherited `word-break: break-word`
       * from `.blockContent` then broke the placeholder one letter per line.
       */}
      <span className='relative inline-grid items-baseline [&>*]:[grid-area:1/1]'>
        <NodeViewContent
          as='span'
          data-slot='reference-picker-query'
          className='min-w-[1ch] outline-none'
        />
        {isEmpty && (
          <span
            contentEditable={false}
            aria-hidden='true'
            className='pointer-events-none select-none whitespace-nowrap text-muted-foreground/60'>
            {trigger === '@' ? 'Search…' : 'Filter…'}
          </span>
        )}
      </span>
    </NodeViewWrapper>
  )
}

/**
 * Inline TipTap node for the in-progress picker chip — both the `@` mention
 * picker and (opt-in via `slash`) the `/` command picker.
 *
 * The chip is **transient** — it represents an open picker. On selection it
 * collapses into a `reference` badge node / runs the picked command; on
 * cancel it collapses to literal `<trigger><query>` text or nothing.
 *
 * Schema: `content: 'text*'` so ProseMirror owns the cursor + selection
 * inside the search hole. Spaces, IME, undo, etc. all Just Work.
 *
 * Attrs: `trigger` ('@' | '/') and `tab` — the chip's scope. For `@` that's
 * the active reference tab; for `/` it's the drill label (null = root).
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
      mention: true,
      slash: false,
      onSlashEnter: undefined,
      onSlashArrowVertical: undefined,
      onSlashBackspacePop: undefined,
      onSlashArrowRight: undefined,
    }
  },

  addAttributes() {
    return {
      trigger: {
        default: '@' as PickerTrigger,
        parseHTML: (el) => (el.getAttribute('data-trigger') as PickerTrigger) ?? '@',
        renderHTML: (attrs) => ({ 'data-trigger': attrs.trigger }),
      },
      tab: {
        default: 'people' as string | null,
        parseHTML: (el) => el.getAttribute('data-tab'),
        renderHTML: (attrs) => (attrs.tab ? { 'data-tab': attrs.tab } : {}),
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

    const makeRule = ({ char, kind, allowedPrefixes }: TriggerConfig) => {
      const esc = `\\${char}`
      // `allowedPrefixes: null` fires anywhere (mid-word — `Hi {name}`);
      // otherwise the trigger only fires at start-of-block or after
      // whitespace. The leading capture group lets the handler keep any
      // preceding whitespace untouched.
      const find = allowedPrefixes === null ? new RegExp(`${esc}$`) : new RegExp(`(^|\\s)${esc}$`)
      return new InputRule({
        find,
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

          // `/` and `{` are literal syntax inside code blocks — never open the
          // picker there. (`@` keeps its historical fire-anywhere behavior.)
          if (kind === 'command' && insideCodeBlock(state.doc.resolve(range.from))) return

          // For a trigger after whitespace, the match starts at the
          // whitespace; at start-of-block (or a mid-word `{`) it starts at the
          // trigger itself. Keep any preceding whitespace untouched.
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
          const initialTab = kind === 'mention' ? (options.tabs?.[0] ?? 'people') : null
          const node = nodeType.create({ trigger: char, tab: initialTab }, state.schema.text(ZWSP))
          tr.replaceRangeWith(atFrom, atTo, node)
          // Place the cursor after the seed ZWSP (inside the chip, offset 2:
          // 1 to enter the chip + 1 to skip the ZWSP).
          tr.setSelection(TextSelection.create(tr.doc, atFrom + 2))
        },
      })
    }

    return resolveTriggers(options).map(makeRule)
  },

  addCommands() {
    const options = this.options
    return {
      /**
       * Open a fresh picker chip at the cursor for `trigger`. Toolbar buttons
       * use this — typing the trigger char fires an input rule, but a
       * programmatic `insertContent` does not, so the button needs an explicit
       * command. No-op if a chip is already open.
       */
      openReferencePicker:
        (trigger: PickerTrigger = '@') =>
        ({ state, chain }) => {
          if (findPickerNode(state)) return false
          const nodeType = state.schema.nodes[REFERENCE_PICKER_NODE]
          if (!nodeType) return false
          const kind = kindForTrigger(options, trigger)
          const initialTab = kind === 'mention' ? (options.tabs?.[0] ?? 'people') : null
          const { from, to } = state.selection
          chain()
            .command(({ tr }) => {
              tr.replaceRangeWith(
                from,
                to,
                nodeType.create({ trigger, tab: initialTab }, state.schema.text(ZWSP))
              )
              tr.setSelection(TextSelection.create(tr.doc, from + 2))
              return true
            })
            .focus()
            .run()
          return true
        },
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
       * plain `<trigger><query>` so typing context isn't lost (used by
       * Escape / click-outside).
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
            const replacement = `${picker.node.attrs.trigger ?? '@'}${text}`
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
      /** Set the active tab on the open `@` picker chip. */
      setReferencePickerTab:
        (tab: ReferenceTab) =>
        ({ commands }) =>
          commands.setPickerScope(tab),
      /**
       * Set the open chip's scope (`tab` attr) — the `@` tab or the `/`
       * drill label. `clearQuery` resets the chip's text to the ZWSP seed so
       * a drilled list starts with a fresh filter.
       */
      setPickerScope:
        (scope: string | null, opts?: { clearQuery?: boolean }) =>
        ({ state, chain }) => {
          const picker = findPickerNode(state)
          if (!picker) return false
          chain()
            .command(({ tr }) => {
              tr.setNodeMarkup(picker.pos, undefined, { ...picker.node.attrs, tab: scope })
              if (opts?.clearQuery) {
                const contentFrom = picker.pos + 1
                const contentTo = contentFrom + picker.node.content.size
                tr.replaceWith(contentFrom, contentTo, state.schema.text(ZWSP))
                tr.setSelection(TextSelection.create(tr.doc, picker.pos + 2))
              }
              return true
            })
            .focus()
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

            const trigger = (pickerNode.attrs.trigger ?? '@') as PickerTrigger
            // `command` triggers (`/`, `{`) share the slash keyboard path
            // (drill + list nav); `mention` (`@`) gets tabs + digit shortcuts.
            const isCommand = kindForTrigger(options, trigger) === 'command'
            const chipFrom = pickerPos
            const chipTo = pickerPos + pickerNode.nodeSize
            const contentStart = pickerPos + 1

            // Real user-visible query (ZWSP seed stripped).
            const realQuery = pickerQueryText(pickerNode)
            const realQueryLen = realQuery.length

            // --- Escape: collapse to plain `<trigger><query>` text ---
            if (event.key === 'Escape') {
              event.preventDefault()
              const replacement = realQuery ? `${trigger}${realQuery}` : ''
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
              const handler = isCommand ? options.onSlashEnter : options.onEnter
              if (handler?.()) {
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
              const handler = isCommand ? options.onSlashArrowVertical : options.onArrowVertical
              if (handler?.(dir)) {
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
              // Empty drilled `/` chip: pop a drill level (mirrors Backspace).
              if (
                isCommand &&
                realQueryLen === 0 &&
                pickerNode.attrs.tab !== null &&
                options.onSlashBackspacePop?.()
              ) {
                event.preventDefault()
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
              // `/` chip: drill into the highlighted item if it's drillable —
              // drill-first, so it wins over caret movement.
              if (isCommand && options.onSlashArrowRight?.()) {
                event.preventDefault()
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
                // Drilled `/` chip: pop a drill level instead of closing —
                // the popover owns the stack; it also resets the chip scope.
                if (isCommand && pickerNode.attrs.tab !== null && options.onSlashBackspacePop?.()) {
                  event.preventDefault()
                  return true
                }
                // Chip holds only the seed ZWSP (or is genuinely empty) →
                // backspace closes the chip in one press.
                const tr = state.tr.delete(chipFrom, chipTo)
                view.dispatch(tr.scrollIntoView())
                return true
              }
              return false
            }

            // --- Digit 1–N: tab quick-access (`@` chips only) ---
            if (!isCommand) {
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
            }

            // --- Tab / Shift+Tab: cycle tabs (`@`); swallow on `/` so focus
            // never escapes the editor while a chip is open ---
            if (event.key === 'Tab') {
              event.preventDefault()
              if (isCommand) return true
              const tabs = options.tabs ?? DEFAULT_TABS
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
      openReferencePicker: (trigger?: PickerTrigger) => ReturnType
      confirmReferencePicker: (recordId: string) => ReturnType
      closeReferencePicker: (opts?: { keepText?: boolean }) => ReturnType
      setReferencePickerTab: (tab: ReferenceTab) => ReturnType
      setPickerScope: (scope: string | null, opts?: { clearQuery?: boolean }) => ReturnType
    }
  }
}
