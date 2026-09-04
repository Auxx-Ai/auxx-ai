// apps/web/src/components/drawers/blocks/index.ts

// The renderers behind the record layout system's block model
// (plans/drawer/record-layout-system.md §4). One entry point per kind, plus the
// Section chrome and gate chain they all share.

export {
  BLOCK_ACTIONS_COMPONENTS,
  type BlockActionsProps,
  getBlockActionsComponent,
} from './block-actions-registry'
export { FieldsBlock, type FieldsBlockProps } from './fields-block'
export {
  type BlockVisibilityContext,
  LayoutBlockSection,
  type LayoutBlockSectionProps,
  useIsBlockVisible,
} from './layout-block-section'
export {
  DEFAULT_VISIBLE_LIMIT,
  RecordListBlock,
  type RecordListBlockProps,
} from './record-list-block'
