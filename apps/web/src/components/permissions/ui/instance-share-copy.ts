// apps/web/src/components/permissions/ui/instance-share-copy.ts

import {
  type Area,
  INSTANCE_ACCESS_KEYS,
  INSTANCE_ACCESS_RESOURCES,
  type InstanceAccessKey,
} from '@auxx/lib/permissions/client'
import { BookOpen, Database, LayoutDashboard, type LucideIcon } from 'lucide-react'

/**
 * Per-resource UI copy for the generic {@link import('./instance-share-card').InstanceShareCard}
 * — the client mirror of the server's `INSTANCE_ACCESS_RESOURCES`. Everything
 * resource-specific about the Share card is DATA here, not code: adding KB /
 * dashboards later is one entry each, no new component (§4).
 */
export interface InstanceShareCopy {
  /** The resource noun, e.g. `'dataset'`. Used in inline copy. */
  noun: string
  /** The "everyone can use it by default" baseline line. */
  baselineHint: string
  /** What Read / Write / Full mean for this resource. */
  levels: { read: string; write: string; full: string }
}

/**
 * Copy keyed by {@link InstanceAccessKey}. Only the resources with an entry here
 * render a Share card — an unsupported def part narrows out to `null`.
 */
export const INSTANCE_SHARE_COPY: Record<InstanceAccessKey, InstanceShareCopy> = {
  dataset: {
    noun: 'dataset',
    baselineHint: 'Everyone in the workspace can use it in search and agents by default.',
    levels: {
      read: 'Use in search & agents',
      write: 'Add & manage files',
      full: 'Change settings',
    },
  },
  kb: {
    noun: 'knowledge base',
    baselineHint: 'Everyone in the workspace can read and write its articles by default.',
    levels: {
      read: 'Read articles',
      write: 'Write & publish articles',
      full: 'Manage the KB & its settings',
    },
  },
  dashboard: {
    noun: 'dashboard',
    baselineHint: 'Shared with the workspace by default. Restrict it to make it private.',
    levels: {
      read: 'View',
      write: 'Edit widgets & layout',
      full: 'Manage & delete',
    },
  },
}

/**
 * Display metadata for the per-instance rows nested under the Datasets /
 * Knowledge base / Dashboards area rows (capability layer v2 Part B) — the
 * `instance-baseline-rows.tsx` / `grantee-instance-rows.tsx` twin of
 * `agent-policy-resources-grid.tsx`'s own local `TYPE_META` (kept separate
 * there — different grid, different write path, §B.2.1).
 */
export const INSTANCE_TYPE_META: Record<InstanceAccessKey, { label: string; icon: LucideIcon }> = {
  dataset: { label: 'Datasets', icon: Database },
  kb: { label: 'Knowledge bases', icon: BookOpen },
  dashboard: { label: 'Dashboards', icon: LayoutDashboard },
}

/**
 * The reverse of `INSTANCE_ACCESS_RESOURCES` — which instance-access key (if
 * any) a given L2 area expands into per-instance rows for. Shared by every
 * `renderChildren` host that nests `InstanceBaselineRows` / `GranteeInstanceRows`
 * under an area row (`member-baseline-tab.tsx`, `grantee-overrides-tab.tsx`,
 * `grantee-levels-section.tsx`) so the mapping is defined once.
 */
export const AREA_TO_INSTANCE_KEY: Partial<Record<Area, InstanceAccessKey>> = Object.fromEntries(
  INSTANCE_ACCESS_KEYS.map((key) => [INSTANCE_ACCESS_RESOURCES[key].area, key])
)

/**
 * Row copy for the two per-instance row scopes (capability layer v2 §B.2.6):
 * the **baseline** scope ("everyone in the workspace") and a **grantee**
 * scope (a specific member/team's own access), which must never borrow the
 * area grid's raise-only framing — instance grants can restrict as well as
 * raise.
 */
export const INSTANCE_ROW_COPY = {
  baseline: {
    description:
      'The default access every member starts with for each item. Expand an item to see or ' +
      'change who else can reach it.',
  },
  grantee: {
    description: (noun: string) => `Their own access to this ${noun}, on top of the default above.`,
  },
} as const

/**
 * The dead-grant warning (capability layer v2 §B.2.8): a `user` grant on an
 * instance is inert when that member's own composed area level is `None` —
 * `effectiveInstanceLevel` closes the area gate before ever consulting the
 * instance row, so the grant silently does nothing until their profile grants
 * the area.
 */
export function deadGrantWarning(areaLabel: string): string {
  return `No effect — their profile has no ${areaLabel} access.`
}
