// packages/lib/src/record-layout/client.ts

/**
 * Client-safe surface of the record layout system.
 *
 * Everything here is pure data plus pure functions: the schemas, the registry
 * default builder, the resolver and the derived tab-visibility rules. The
 * drawer, the detail view and the layout editor all run these in the browser, so
 * this module must never reach a db-touching import. Those live in
 * `./layout-store`, reachable only through `./index`.
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
