// packages/lib/src/record-layout/index.ts

/**
 * The record layout system (`plans/drawer/record-layout-system.md`).
 *
 * Server surface: everything in `./client` plus the two stored layers. Client
 * components must import `@auxx/lib/record-layout/client` instead, which carries
 * no db import.
 */

export {
  fieldsBlockConfigSchema,
  type ParsedFieldsBlockConfig,
  type ParsedRecordsBlockConfig,
  parseFieldsBlockConfig,
  parseRecordsBlockConfig,
  recordsBlockConfigSchema,
  recordsQuerySourceSchema,
  recordsRelationSourceSchema,
  recordsSourceSchema,
} from './block-config-schemas'
export {
  type AddedTab,
  addedTabSchema,
  type BlockDelta,
  blockDeltaSchema,
  type CreatedBlock,
  createdBlockSchema,
  EMPTY_RECORD_LAYOUT_DELTA,
  type RecordLayoutDelta,
  type RecordLayoutSurface,
  recordLayoutDeltaSchema,
  recordLayoutSurfaces,
  tabsDeltaSchema,
} from './layout-delta'
export {
  getRecordLayoutDeltas,
  parseRecordLayoutDelta,
  type RecordLayoutDeltas,
  type RecordLayoutTarget,
  recordLayoutPreferenceTableId,
  recordLayoutViewName,
  resetOrgRecordLayout,
  resetPersonalRecordLayout,
  saveOrgRecordLayout,
  savePersonalRecordLayout,
} from './layout-store'
export { type MergeBlockOrderParams, mergeBlockOrder } from './merge-block-order'
export {
  buildRegistryLayout,
  flattenBlockOrder,
  flattenTabOrder,
  isBaseTabId,
  OVERVIEW_TAB_ID,
  RECORD_LAYOUT_BASE_TAB_IDS,
  type RegistryLayoutInput,
} from './registry-layout'
export {
  type RelationTargetResolver,
  type ResolveRecordLayoutParams,
  resolveRecordLayout,
} from './resolve-layout'
export type { ResolvedLayout, ResolvedLayoutTab } from './resolved-layout'
export {
  isTabPermitted,
  isTabVisible,
  permittedLayoutTabs,
  type TabVisibilityContext,
  visibleLayoutTabs,
  visibleTabBlocks,
} from './tab-visibility'
