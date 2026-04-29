// packages/ui/src/components/kb/layout/index.ts

export { KBFooter } from './kb-footer'
export { KBHeader, type KBHeaderProps, type KBNavLink } from './kb-header'
export { KBLayout, type KBLayoutKB } from './kb-layout'
export {
  KBLayoutContextProvider,
  type KBLayoutContextValue,
  useKBLayoutContext,
  useKBLayoutContextOptional,
} from './kb-layout-context'
export { KBLayoutShell } from './kb-layout-shell'
export { KBSidebar } from './kb-sidebar'
export { KBSidebarMobileTrigger } from './kb-sidebar-mobile-trigger'
export {
  filterToTab,
  findTabForArticle,
  getTopLevelTabs,
  KBSidebarTabs,
} from './kb-sidebar-tabs'
export { KBSidebarToggle } from './kb-sidebar-toggle'
export {
  type KBSidebarArticle,
  type KBSidebarListStyle,
  KBSidebarTree,
} from './kb-sidebar-tree'
