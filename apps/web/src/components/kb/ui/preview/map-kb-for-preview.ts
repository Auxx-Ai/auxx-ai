// apps/web/src/components/kb/ui/preview/map-kb-for-preview.ts

import { mergeDraftOverLive } from '@auxx/lib/kb/client'
import type { KnowledgeBase } from '../../store/knowledge-base-store'

/**
 * Project a store KnowledgeBase into the shape KBLayout expects. Always merges
 * `draftSettings` over the live columns so admin previews reflect unpublished
 * edits — the public site reads from live columns directly and isn't affected.
 */
export function mapKBForPreview(kb: KnowledgeBase) {
  const merged = mergeDraftOverLive(kb as Record<string, unknown>) as KnowledgeBase
  return {
    id: merged.id,
    name: merged.name,
    defaultMode: merged.defaultMode,
    showMode: merged.showMode,
    primaryColorLight: merged.primaryColorLight,
    primaryColorDark: merged.primaryColorDark,
    tintColorLight: merged.tintColorLight,
    tintColorDark: merged.tintColorDark,
    infoColorLight: merged.infoColorLight,
    infoColorDark: merged.infoColorDark,
    successColorLight: merged.successColorLight,
    successColorDark: merged.successColorDark,
    warningColorLight: merged.warningColorLight,
    warningColorDark: merged.warningColorDark,
    dangerColorLight: merged.dangerColorLight,
    dangerColorDark: merged.dangerColorDark,
    fontFamily: merged.fontFamily,
    cornerStyle: merged.cornerStyle,
    logoLight: merged.logoLight,
    logoDark: merged.logoDark,
    searchbarPosition: merged.searchbarPosition,
    headerNavigation: merged.headerNavigation,
    footerNavigation: merged.footerNavigation,
    theme: merged.theme,
    sidebarListStyle: merged.sidebarListStyle,
    headerEnabled: merged.headerEnabled,
    footerEnabled: merged.footerEnabled,
  }
}
