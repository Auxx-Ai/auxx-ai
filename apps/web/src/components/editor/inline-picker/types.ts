// apps/web/src/components/editor/inline-picker/types.ts

import type { Editor, JSONContent } from '@tiptap/react'

/**
 * Suggestion state exposed to React for picker positioning.
 * This is emitted by the extension and consumed by the parent component.
 */
export interface InlinePickerState {
  /** Whether the picker popover should be visible */
  isOpen: boolean
  /** Current search query (text after trigger character) */
  query: string
  /** Text range to replace when inserting */
  range: { from: number; to: number } | null
  /** Position for popover placement (cursor position) */
  clientRect: DOMRect | null
}

/**
 * Configuration for creating an inline picker extension.
 */
export interface InlinePickerExtensionConfig {
  /** Node type - used for extension naming */
  type: string
  /** Trigger character (e.g., '@', '#', '{') */
  trigger: string
  /** Allow spaces in query (default: false) */
  allowSpaces?: boolean
  /**
   * Characters allowed to directly precede the trigger. Default `[' ']` —
   * the trigger only fires after a space or at the start of a node. This
   * prevents URLs / email addresses (`http://`, `foo@bar.com`) from opening
   * pickers. Pass `null` to allow the trigger anywhere, including mid-word
   * (useful for free-text editors where the trigger is semantic syntax,
   * e.g. `{` for a placeholder).
   */
  allowedPrefixes?: string[] | null
  /** Callback when suggestion state changes */
  onStateChange: (state: InlinePickerState) => void
}

/**
 * Configuration for paste handler pattern matching.
 */
export interface PastePatternConfig {
  /** Regex pattern to match in pasted text (must have capture group for the id) */
  pattern: RegExp
  /** Function to extract id from regex match */
  getId: (match: RegExpExecArray) => string
}

/**
 * Configuration for input rules (auto-conversion).
 */
export interface InputRuleConfig {
  /** Regex pattern to match (must end with $) */
  find: RegExp
  /** Extract id from match */
  getId: (match: RegExpExecArray) => string
}

/**
 * Config for a single extra attribute on an inline node.
 *
 * Typed payloads (e.g. the placeholder fallback JSON blob) round-trip through
 * the DOM as strings — `serialize` runs on render, `parse` on DOM parse. If
 * omitted, the value is stored as-is (expects string).
 */
export interface ExtraAttrConfig<T = unknown> {
  /** Default runtime value when the attribute is absent. */
  default: T | null
  /** DOM `data-*` attribute name. Defaults to `data-${kebab(key)}`. */
  dataAttr?: string
  /** Runtime value → attribute string. */
  serialize?: (value: T) => string
  /** Attribute string → runtime value. */
  parse?: (raw: string | null) => T | null
}

/**
 * Configuration for creating an inline node.
 */
export interface InlineNodeConfig {
  /** Node type - used for TipTap name AND data-type attribute */
  type: string
  /** How to serialize the node id to plain text (for copy/paste) */
  serialize: (id: string) => string
  /** Optional paste pattern config for parsing pasted text */
  pastePattern?: PastePatternConfig
  /** Optional input rules for auto-conversion (e.g., {fieldKey} -> node) */
  inputRules?: InputRuleConfig[]
  /**
   * Additional node attributes. Keys become `node.attrs.<key>` and are
   * serialized to / parsed from the DOM via optional codec functions.
   */
  extraAttrs?: Record<string, ExtraAttrConfig>
}

/**
 * Props passed to the badge render function.
 * Badge receives the id plus node-level controls so interactive content
 * (popovers, dropdowns) can mutate or delete the node in place.
 */
export interface InlineNodeBadgeProps {
  /** Node identifier */
  id: string
  /** Whether the node is currently selected */
  selected: boolean
  /** All node attributes (includes `id` + any `extraAttrs`). */
  attrs: Record<string, unknown>
  /** Patch node attrs — maps to TipTap's `updateAttributes`. */
  updateAttributes: (attrs: Record<string, unknown>) => void
  /** Remove the node from the document. */
  deleteNode: () => void
}

/**
 * Options for the useInlinePicker hook.
 */
export interface UseInlinePickerOptions {
  /** Node type (e.g., 'mention', 'record-link', 'field') */
  type: string
  /** Trigger character (e.g., '@', '#', '{') */
  trigger: string
  /** Initial HTML content */
  initialContent?: string
  /** Placeholder text when editor is empty */
  placeholder?: string
  /** How to serialize node id to plain text */
  serialize?: (id: string) => string
  /** How to render the node badge - receives id and selected state */
  renderBadge: (props: InlineNodeBadgeProps) => React.ReactNode
  /** Optional paste pattern for parsing pasted content */
  pastePattern?: PastePatternConfig
  /** Optional input rules for auto-conversion */
  inputRules?: InputRuleConfig[]
  /** Additional TipTap extensions */
  extensions?: unknown[]
  /** Callback when editor content changes */
  onUpdate?: (editor: Editor) => void
  /** Callback when JSON content changes */
  onJsonUpdate?: (json: JSONContent) => void
  /** Enable editable mode (default: true) */
  editable?: boolean
  /** Custom editor class name */
  editorClassName?: string
  /** Immediately render (default: false for SSR safety) */
  immediatelyRender?: boolean
}

/**
 * Return type for useInlinePicker hook.
 */
export interface UseInlinePickerReturn {
  /** TipTap editor instance */
  editor: Editor | null
  /** Current suggestion state for rendering picker */
  suggestionState: InlinePickerState
  /** Insert an item at the trigger position */
  insertItem: (id: string) => void
  /** Close picker without inserting */
  closePicker: () => void
  /** Get current HTML content */
  getHTML: () => string
  /** Get plain text content */
  getText: () => string
  /** Get JSON content */
  getJSON: () => JSONContent | undefined
  /** Set content programmatically */
  setContent: (content: string | JSONContent) => void
}

/**
 * Props for the InlinePickerPopover component.
 */
export interface InlinePickerPopoverProps {
  /** Current suggestion state */
  state: InlinePickerState
  /** @deprecated No longer used - popover uses fixed positioning via portal */
  containerRef?: React.RefObject<HTMLElement | null>
  /** Picker content to render */
  children: React.ReactNode
  /** Additional class names */
  className?: string
  /** Width of the popover (default: 280) */
  width?: number | 'auto'
  /** Called when picker should close (Escape pressed) */
  onClose?: () => void
  /** Auto-focus the search input when opened (default: true) */
  autoFocus?: boolean
}
