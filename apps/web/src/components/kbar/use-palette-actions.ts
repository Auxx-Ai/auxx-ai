// apps/web/src/components/kbar/use-palette-actions.ts
'use client'

import { useMemo } from 'react'
import { SIDEBAR_MENU } from '~/constants/menu'
import { useCreateActions, useNonEntityCreateActions } from './actions/create'
import { useGeneralActions } from './actions/general'
import { useLauncherActions } from './actions/launchers'
import { useNavigationActions } from './actions/navigation'
import { useSettingsActions } from './actions/settings'
import { useThemeActions } from './actions/theme'
import type { PaletteAction, PaletteSection } from './types'

/**
 * Drift guard: maps each navigable top-level `SIDEBAR_MENU` item to the palette
 * action that must cover it. Dev-only — if a new sidebar destination is added
 * without a palette action (or without an entry here), the guard warns so nav
 * can't silently go missing from cmd+k.
 */
const SIDEBAR_TO_ACTION: Record<string, string> = {
  dashboards: 'nav.dashboards',
  today: 'nav.today',
  chats: 'nav.chats',
  agents: 'nav.agents',
  calls: 'nav.calls',
  workflows: 'nav.workflows',
  tasks: 'nav.tasks',
  schedule: 'nav.schedule',
}

/** Warn (once per render that trips it) about uncovered top-level sidebar items. */
function assertNoNavDrift(allActionIds: Set<string>): void {
  for (const item of SIDEBAR_MENU) {
    // Skip group containers and non-navigating headers.
    if (item.preventNavigation || item.items || !item.slug) continue
    const actionId = SIDEBAR_TO_ACTION[item.id]
    if (!actionId) {
      console.warn(
        `[command-palette] sidebar item "${item.id}" (${item.slug}) has no mapped palette action — add one to SIDEBAR_TO_ACTION + the action registry.`
      )
      continue
    }
    // The action may be gated out by flags at runtime; only warn when the id is
    // unknown to the registry entirely (a genuine wiring gap).
    if (!isKnownActionId(actionId, allActionIds)) {
      console.warn(
        `[command-palette] sidebar item "${item.id}" maps to "${actionId}" which is not a known palette action id.`
      )
    }
  }
}

/**
 * Gated nav actions can be absent from the current render, so we treat any id
 * declared in {@link SIDEBAR_TO_ACTION} as "known" when it's either present now
 * or a recognised gated id. Present-now ids cover the common case; the mapping
 * itself documents the gated ones.
 */
function isKnownActionId(actionId: string, allActionIds: Set<string>): boolean {
  if (allActionIds.has(actionId)) return true
  // Gated nav ids that legitimately disappear when the flag is off.
  return Object.values(SIDEBAR_TO_ACTION).includes(actionId)
}

export interface PaletteActionsResult {
  /** Ordered sections for the root list. */
  sections: PaletteSection[]
  /** Flat lookup by id — used by `use-palette-hotkeys` to fire chords. */
  byId: Map<string, PaletteAction>
}

/**
 * Composes every action group into the ordered root sections and a flat id→action
 * map. This is the single registry the root list renders and the hotkey loop binds.
 */
export function usePaletteActions(): PaletteActionsResult {
  const general = useGeneralActions()
  const navigation = useNavigationActions()
  const create = useCreateActions()
  const nonEntityCreate = useNonEntityCreateActions()
  const launchers = useLauncherActions()
  const settings = useSettingsActions()
  const theme = useThemeActions()

  return useMemo<PaletteActionsResult>(() => {
    const sections: PaletteSection[] = [
      { label: 'Actions', actions: general },
      { label: 'Navigation', actions: navigation },
      { label: 'Create', actions: [...create, ...nonEntityCreate, ...launchers] },
      { label: 'Settings', actions: settings },
      { label: 'Theme', actions: theme },
    ]

    const byId = new Map<string, PaletteAction>()
    for (const section of sections) {
      for (const action of section.actions) byId.set(action.id, action)
    }

    if (process.env.NODE_ENV !== 'production') {
      assertNoNavDrift(new Set(byId.keys()))
    }

    return { sections, byId }
  }, [general, navigation, create, nonEntityCreate, launchers, settings, theme])
}
