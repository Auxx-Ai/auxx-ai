// apps/web/src/components/editor/inline-picker/index.ts

export { createInlineNode } from './core/inline-node'
export { createInlineNodeView } from './core/inline-node-view'
// Core factories
export { createInlinePickerExtension } from './core/inline-picker-extension'
export { stripOpenChips } from './core/strip-open-chips'
export { type ActivePickerState, useActivePicker, useHasOpenChip } from './hooks/use-active-picker'
// Hooks
export {
  type ContentApplier,
  type ExternalContentSyncHandle,
  makeContentApplier,
  stableStringify,
  useExternalContentSync,
} from './hooks/use-external-content-sync'
export { useInlinePicker } from './hooks/use-inline-picker'
export { useMentionEditor } from './hooks/use-mention-editor'
export { useRecordLinkEditor } from './hooks/use-record-link-editor'
export { useReferenceEditor } from './hooks/use-reference-editor'
export { useReferencePickerEditor } from './hooks/use-reference-picker-editor'
export { useSlashCommand } from './hooks/use-slash-command'
export { PlaceholderBadge } from './nodes/placeholder-badge'
// Nodes
export { createPlaceholderNode } from './nodes/placeholder-node'
export { createPromptNode } from './nodes/prompt-node'
export { PromptTemplateBadge } from './nodes/prompt-node-view'
export {
  DEFAULT_TABS,
  getOpenPickerRange,
  type PickerTrigger,
  REFERENCE_PICKER_NODE,
  ReferencePickerNode,
  type ReferenceTab,
  TAB_LABEL,
} from './nodes/reference-picker-node'
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
