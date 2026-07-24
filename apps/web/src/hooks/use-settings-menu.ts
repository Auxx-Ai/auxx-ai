// apps/web/src/hooks/use-settings-menu.ts
'use client'

import { useMemo } from 'react'
import type { SidebarProps } from '~/constants/menu'
import { useIsSelfHosted } from '~/hooks/use-deployment-mode'
import { useUser } from '~/hooks/use-user'
import { useAccess } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'

/**
 * Applies every settings-menu visibility predicate and drops groups that end up
 * empty. This is the single source of truth for "which settings can this member
 * actually reach" — `SidebarSecondary` renders it, its search indexes it, and the
 * command palette derives its settings actions from it.
 *
 * Anything building a settings index MUST go through this hook rather than reading
 * `SETTINGS_MENU` directly, or it will surface pages the member 403s on.
 *
 * Filter order mirrors the original inline chain: self-hosted → feature flag → role
 * → def-admin → Layer-2 capability. ADMIN/OWNER hold every capability key via
 * ROLE_DEFAULTS, so no admin bypass is needed for `permissionKey`.
 */
export function useSettingsMenu(groups: SidebarProps[]): SidebarProps[] {
  const selfHosted = useIsSelfHosted()
  const { isAdminOrOwner } = useUser({ requireOrganization: true })
  const { hasAccess: hasFeatureAccess } = useFeatureFlags()
  const { can, administersAnyDef } = useAccess()

  return useMemo(() => {
    const role: 'ADMIN' | 'USER' = isAdminOrOwner ? 'ADMIN' : 'USER'

    return groups.flatMap((group) => {
      if (group.access && group.access !== role) return []

      const items = (group.items ?? []).filter(
        (item) =>
          (!selfHosted || !item.cloudOnly) &&
          (!item.featureKey || hasFeatureAccess(item.featureKey)) &&
          (!item.access || item.access === role) &&
          // Custom Fields is *derived* from def-admin, not its own Layer-2 area
          // (perms v2 doc 09); the page lists only the defs the member administers.
          (!item.requiresDefAdmin || administersAnyDef) &&
          (!item.permissionKey || can(item.permissionKey))
      )

      return items.length > 0 ? [{ ...group, items }] : []
    })
  }, [groups, selfHosted, isAdminOrOwner, hasFeatureAccess, can, administersAnyDef])
}
