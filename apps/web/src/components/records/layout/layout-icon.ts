// apps/web/src/components/records/layout-editor/layout-icon.ts

import { getIcon } from '@auxx/ui/components/icons'
import type { LucideIcon } from 'lucide-react'
import { getIconComponent } from '~/components/detail-view/utils'

/**
 * Resolve a stored icon NAME to a component, across both icon tables.
 *
 * A layout stores icons the way the registry does: a name, never a component
 * (`plans/drawer/record-layout-system.md` §9.4), but the two names come from
 * two different tables that only partly overlap:
 *
 * - `getIconComponent`'s `ICON_MAP` is what the drawer and the detail view
 * already resolve registry icons through, and it carries entries the picker
 * does not (`house`, `messages`).
 * - `ICON_DATA` is what `IconPicker` offers, and it carries entries the map does
 * not (`folder`).
 *
 * Looking in the picker's table first and falling back to the registry map is
 * what lets one function render a shipped tab's icon and an admin-picked one
 * side by side. Without it, an icon chosen in this dialog renders as the generic
 * fallback box.
 */
export function resolveLayoutIcon(iconName: string | undefined): LucideIcon | null {
  if (!iconName) return null
  const picked = getIcon(iconName)
  if (picked) return picked.icon
  return getIconComponent(iconName)
}
