// apps/web/src/components/records/layout-editor/index.ts

/**
 * The record layout editor (`plans/drawer/record-layout-system.md` §9, stages
 * 3 and 4).
 *
 * The dialog is the whole public surface; everything else is exported for tests
 * and for the surfaces that need to resolve a stored icon name the same way this
 * editor writes it.
 */

export { resolveLayoutIcon } from '~/components/records/layout/layout-icon'
export { AddSectionMenu, type AddSectionMenuProps } from './add-section-popover'
export {
  addBlockToTab,
  createTab,
  deleteCreatedBlock,
  deleteCreatedTab,
  isLastVisibleBlockOfTab,
  isTabVisibilityLocked,
  type MoveBlockParams,
  moveBlock,
  moveTab,
  setBlockHidden,
  setTabHidden,
  tabOfDropId,
  updateCreatedTab,
} from './editor-actions'
export {
  blocksOfTab,
  type EditorTab,
  type LayoutEditorState,
  normalizeBlockOrder,
  type SeedEditorStateParams,
  seedEditorState,
  visibleTabCount,
} from './editor-state'
export {
  addableBlocks,
  type BuildEditorTreeParams,
  buildEditorTree,
  type EditorTree,
  type LayoutEditorGroup,
  type LayoutEditorRow,
  type LayoutRowStatus,
} from './editor-tree'
export {
  type DiffEditorStateParams,
  diffEditorState,
  type LayoutSaveDeltas,
  type LayoutSaveWrite,
  type PlanLayoutSaveParams,
  planLayoutSave,
  serializeSaveDeltas,
} from './layout-diff'
export { LayoutEditorTree, type LayoutEditorTreeProps } from './layout-editor-tree'
export { NewSectionForm, type NewSectionFormProps, type NewSectionKind } from './new-section-form'
export {
  RecordLayoutEditorDialog,
  type RecordLayoutEditorDialogProps,
} from './record-layout-editor-dialog'
export { useBlockEmptyHere } from './use-block-empty-here'
export {
  type UseLayoutEditorParams,
  type UseLayoutEditorResult,
  useLayoutEditor,
} from './use-layout-editor'
