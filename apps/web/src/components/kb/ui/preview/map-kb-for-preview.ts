// apps/web/src/components/kb/ui/preview/map-kb-for-preview.ts

import type { KnowledgeBase } from '../../store/knowledge-base-store'

/** Project a store KnowledgeBase into the shape KBLayout expects. */
export function mapKBForPreview(kb: KnowledgeBase) {
  return {
    id: kb.id,
    name: kb.name,
    defaultMode: kb.defaultMode,
    showMode: kb.showMode,
    primaryColorLight: kb.primaryColorLight,
    primaryColorDark: kb.primaryColorDark,
    tintColorLight: kb.tintColorLight,
    tintColorDark: kb.tintColorDark,
    infoColorLight: kb.infoColorLight,
    infoColorDark: kb.infoColorDark,
    successColorLight: kb.successColorLight,
    successColorDark: kb.successColorDark,
    warningColorLight: kb.warningColorLight,
    warningColorDark: kb.warningColorDark,
    dangerColorLight: kb.dangerColorLight,
    dangerColorDark: kb.dangerColorDark,
    fontFamily: kb.fontFamily,
    cornerStyle: kb.cornerStyle,
    logoLight: kb.logoLight,
    logoDark: kb.logoDark,
    searchbarPosition: kb.searchbarPosition,
    headerNavigation: kb.headerNavigation,
    footerNavigation: kb.footerNavigation,
    theme: kb.theme,
    sidebarListStyle: kb.sidebarListStyle,
    headerEnabled: kb.headerEnabled,
    footerEnabled: kb.footerEnabled,
  }
}
