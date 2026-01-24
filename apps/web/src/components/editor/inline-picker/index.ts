// apps/web/src/components/editor/inline-picker/index.ts

// Types
export type {
  InlinePickerState,
  InlinePickerExtensionConfig,
  InlineNodeConfig,
  InlineNodeBadgeProps,
  PastePatternConfig,
  InputRuleConfig,
  UseInlinePickerOptions,
  UseInlinePickerReturn,
  InlinePickerPopoverProps,
} from './types'

// Core factories
export { createInlinePickerExtension } from './core/inline-picker-extension'
export { createInlineNode } from './core/inline-node'
export { createInlineNodeView } from './core/inline-node-view'

// Hooks
export { useInlinePicker } from './hooks/use-inline-picker'
export { useMentionEditor } from './hooks/use-mention-editor'
export { useRecordLinkEditor } from './hooks/use-record-link-editor'

// UI Components
export { InlinePickerPopover } from './ui/inline-picker-popover'
