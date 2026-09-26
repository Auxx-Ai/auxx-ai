// packages/lib/src/sidebar-layout/client.ts
// Client-safe surface of the unified sidebar: types, constants, the pure resolver.

export {
  compareSidebarNodes,
  countFavoriteBudget,
  DEFAULT_SIDEBAR_NAV_IDS,
  isFavoriteItem,
  isFavoriteTargetType,
  isSystemGroupKey,
  type ParsedSidebarRef,
  parseSidebarRef,
  SIDEBAR_DEFAULT_LAYOUT_SETTING_KEY,
  SIDEBAR_SYSTEM_GROUP_KEYS,
  SIDEBAR_SYSTEM_GROUP_TITLES,
  SIDEBAR_TITLE_MAX,
  sidebarRef,
} from './constants'
export { homeGroupFor, type ResolveSidebarLayoutInput, resolveSidebarLayout } from './resolve'
export { toResourceNav } from './resource-nav'
export {
  codeDefaultSnapshot,
  parseSidebarLayoutSnapshot,
  sidebarLayoutSnapshotSchema,
  snapshotFromLayout,
} from './snapshot'
export type {
  DehydratedSidebar,
  ResolvedSidebarFolder,
  ResolvedSidebarGroup,
  ResolvedSidebarItem,
  ResolvedSidebarLayout,
  ResourceNavEntry,
  SidebarLayoutSnapshot,
  SidebarLayoutTargetIdsMap,
  SidebarLayoutTargetType,
  SidebarMutationResult,
  SidebarNodeEntity,
  SidebarNodeType,
  SidebarSnapshotGroup,
  SidebarSnapshotItem,
  SidebarSnapshotNode,
  SidebarSystemGroupKey,
  SidebarTargetType,
} from './types'
