// apps/web/src/components/editor/inline-picker/index.ts

export { createInlineNode } from './core/inline-node'
export { createInlineNodeView } from './core/inline-node-view'
// Core factories
export { createInlinePickerExtension } from './core/inline-picker-extension'
// Hooks
export { useInlinePicker } from './hooks/use-inline-picker'
export { useMentionEditor } from './hooks/use-mention-editor'
export { useRecordLinkEditor } from './hooks/use-record-link-editor'
// Types
export type {
  InlineNodeBadgeProps,
  InlineNodeConfig,
  InlinePickerExtensionConfig,
  InlinePickerPopoverProps,
  InlinePickerState,
  InputRuleConfig,
  PastePatternConfig,
  UseInlinePickerOptions,
  UseInlinePickerReturn,
} from './types'

// UI Components
export { InlinePickerPopover } from './ui/inline-picker-popover'
