// apps/web/src/components/kbar/actions/settings.ts
'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useMemo } from 'react'
import { SETTINGS_MENU } from '~/constants/menu'
import { useSettingsMenu } from '~/hooks/use-settings-menu'
import { SHORTCUTS } from '../shortcuts'
import { useCommandPaletteStore } from '../store'
import type { PaletteAction } from '../types'

/**
 * Palette metadata per `SETTINGS_MENU` item id: the stable action id — which keys
 * both `SHORTCUTS` and the recents store, so it must not change — plus an icon id
 * from the shared registry.
 *
 * Items missing from this map still produce an action (id `settings.<slug>`, no
 * icon), so a new settings page is reachable from the palette the moment it lands
 * in the menu.
 */
const PALETTE_META: Record<string, { id: string; icon: string }> = {
  'settings-general': { id: 'settings.general', icon: 'settings' },
  'settings-account': { id: 'settings.account', icon: 'circle-user' },
  'settings-organization': { id: 'settings.organization', icon: 'building' },
  'settings-members': { id: 'settings.members', icon: 'users' },
  'settings-permissions': { id: 'settings.permissions', icon: 'shield-check' },
  'admin-plans': { id: 'settings.billing', icon: 'credit-card' },
  'settings-activity-log': { id: 'settings.activityLog', icon: 'history' },
  'admin-fields': { id: 'settings.customFields', icon: 'text-cursor-input' },
  'admin-tags': { id: 'settings.tags', icon: 'tag' },
  'admin-import-history': { id: 'settings.importHistory', icon: 'download' },
  'admin-rules': { id: 'settings.rules', icon: 'zap' },
  'settings-aiModels': { id: 'settings.aiModels', icon: 'sparkles' },
  'settings-kopilot': { id: 'settings.kopilot', icon: 'sparkles' },
  'settings-channels': { id: 'settings.channels', icon: 'inbox' },
  'settings-inboxes': { id: 'settings.inbox', icon: 'inbox' },
  'settings-signatures': { id: 'settings.signatures', icon: 'pen-tool' },
  'settings-snippets': { id: 'settings.snippets', icon: 'braces' },
  'settings-apps': { id: 'settings.apps', icon: 'boxes' },
  'settings-connections': { id: 'settings.connections', icon: 'cable' },
  'settings-webhooks': { id: 'settings.webhooks', icon: 'webhook' },
  'settings-apiKeys': { id: 'settings.apiKeys', icon: 'key' },
}

/**
 * Settings navigation actions, **derived** from `SETTINGS_MENU` through
 * `useSettingsMenu()` — the same filtered menu the settings sidebar renders.
 *
 * This used to be a hand-maintained mirror of the menu and had drifted: it gated on
 * `isAdminOrOwner` where the sidebar gates on Layer-2 `permissionKey` (so a member
 * holding `members.manage` saw "Members and Groups" in the nav but could not find it
 * here), and it omitted Permissions, Rules and Connections entirely. Deriving keeps
 * the two surfaces honest by construction — do not reintroduce a parallel list.
 */
export function useSettingsActions(): PaletteAction[] {
  const router = useRouter()
  const groups = useSettingsMenu(SETTINGS_MENU)

  const goToSetting = useCallback(
    (slug: string) => {
      router.push(`/app/settings/${slug}`)
      useCommandPaletteStore.getState().close()
    },
    [router]
  )

  return useMemo<PaletteAction[]>(() => {
    const actions: PaletteAction[] = groups.flatMap((group) =>
      (group.items ?? []).flatMap((item) => {
        if (!item.slug) return []
        const meta = PALETTE_META[item.id]
        const id = meta?.id ?? `settings.${item.slug}`
        const slug = item.slug

        return [
          {
            id,
            label: item.label,
            subtitle: item.description,
            icon: meta?.icon,
            keywords: [group.label, ...(item.keywords ?? [])].join(' '),
            shortcut: SHORTCUTS[id],
            perform: () => goToSetting(slug),
          },
        ]
      })
    )

    // `/app/settings/groups` is a live route with an `s,r` chord but is deliberately
    // absent from the nav (groups are reached via "Members and Groups"). Derived
    // actions can't see it, so it stays explicit — gated on the same visibility as
    // the Members item rather than on a separate role check.
    const canSeeMembers = groups.some((group) =>
      group.items?.some((item) => item.id === 'settings-members')
    )
    if (canSeeMembers) {
      actions.push({
        id: 'settings.groups',
        label: 'Groups',
        icon: 'layers',
        keywords: 'groups teams',
        shortcut: SHORTCUTS['settings.groups'],
        perform: () => goToSetting('groups'),
      })
    }

    return actions
  }, [groups, goToSetting])
}
