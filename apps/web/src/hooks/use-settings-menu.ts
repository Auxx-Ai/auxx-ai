// apps/web/src/hooks/use-settings-menu.ts
'use client'

import { useMemo } from 'react'
import type { SidebarProps } from '~/constants/menu'
import { useIsSelfHosted } from '~/hooks/use-deployment-mode'
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
 * Filter order: self-hosted → feature flag → def-admin → Layer-2 capability.
 * ADMIN/OWNER hold every capability key via ROLE_DEFAULTS, so no admin bypass is
 * needed for `permissionKey`.
 *
 * The `role` branch is GONE (plan 39 §1.3). This hook used to decide on both
 * systems in one expression — a `permissionKey` item was capability-gated while
 * an `access: 'ADMIN'` item fell back to the org role — so a menu entry could
 * appear for a key-holder whose page then bounced them, or hide from someone the
 * page would have admitted. The last three role-gated items (tags, import
 * history, inboxes) took real keys once `settings` became grantable, leaving
 * nothing for the role branch to decide.
 */
export function useSettingsMenu(groups: SidebarProps[]): SidebarProps[] {
  const selfHosted = useIsSelfHosted()
  const { hasAccess: hasFeatureAccess } = useFeatureFlags()
  const { can, administersAnyDef } = useAccess()

  return useMemo(
    () =>
      groups.flatMap((group) => {
        const items = (group.items ?? []).filter(
          (item) =>
            (!selfHosted || !item.cloudOnly) &&
            (!item.featureKey || hasFeatureAccess(item.featureKey)) &&
            // Custom Fields is *derived* from def-admin, not its own Layer-2 area
            // (perms v2 doc 09); the page lists only the defs the member administers.
            (!item.requiresDefAdmin || administersAnyDef) &&
            (!item.permissionKey || can(item.permissionKey))
        )

        return items.length > 0 ? [{ ...group, items }] : []
      }),
    [groups, selfHosted, hasFeatureAccess, can, administersAnyDef]
  )
}
