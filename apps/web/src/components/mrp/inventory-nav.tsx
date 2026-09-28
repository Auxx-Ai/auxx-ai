// apps/web/src/components/mrp/inventory-nav.tsx

import { FeatureKey, PermissionKey } from '@auxx/lib/permissions/client'
import {
  Boxes,
  Flag,
  Globe,
  History,
  ListChecks,
  SlidersHorizontal,
  Table2,
  Truck,
} from 'lucide-react'
import type { SidebarProps } from '~/constants/menu'

/** Base URL of the Inventory module; every rail row is `${INVENTORY_BASE_URL}/${slug}`. */
export const INVENTORY_BASE_URL = '/app/inventory'

/**
 * The Inventory rail (plans/mrp/18-inventory-module.md). Flat slugs: the groups are rail
 * labels, not path segments. `useSettingsMenu` drops a group once every row is
 * filtered out, so a buyer with `mrp.view` sees only Planning and an admin without the
 * MRP feature sees only Setup.
 */
export const INVENTORY_NAV: SidebarProps[] = [
  {
    id: 'inventory-plan',
    label: 'Planning',
    type: 'header',
    items: [
      {
        id: 'inventory-plan-plan',
        label: 'Action list',
        slug: 'plan',
        icon: <ListChecks />,
        description: 'What to order or build now, from the latest plan run',
        keywords: ['mrp', 'reorder', 'suggestions', 'buy', 'build', 'purchase order'],
        permissionKey: PermissionKey.mrpView,
        featureKey: FeatureKey.mrp,
      },
      {
        id: 'inventory-plan-suppliers',
        label: 'Suppliers',
        slug: 'suppliers',
        icon: <Truck />,
        description: 'Each supplier’s next order and how reliably it delivers',
        keywords: ['vendor', 'order cycle', 'next order', 'lead time'],
        permissionKey: PermissionKey.mrpView,
        featureKey: FeatureKey.mrp,
      },
      {
        id: 'inventory-plan-all-parts',
        label: 'All parts',
        slug: 'all-parts',
        icon: <Table2 />,
        description: 'Every part in the run, with its usage, cover and buffer',
        keywords: ['days of cover', 'adu', 'buffer', 'grid'],
        permissionKey: PermissionKey.mrpView,
        featureKey: FeatureKey.mrp,
      },
      {
        id: 'inventory-plan-flags',
        label: 'Flags',
        slug: 'flags',
        icon: <Flag />,
        description: 'Parts the plan could not size with confidence',
        keywords: ['warnings', 'data quality', 'missing lead time'],
        permissionKey: PermissionKey.mrpView,
        featureKey: FeatureKey.mrp,
      },
      {
        id: 'inventory-plan-runs',
        label: 'Runs',
        slug: 'runs',
        icon: <History />,
        description: 'Past plan runs and what each one found',
        keywords: ['history', 'run log'],
        permissionKey: PermissionKey.mrpView,
        featureKey: FeatureKey.mrp,
      },
    ],
  },
  {
    id: 'inventory-setup',
    label: 'Setup',
    type: 'header',
    items: [
      {
        id: 'inventory-setup-stock',
        label: 'Stock setup',
        slug: 'setup',
        icon: <Boxes />,
        description: 'What each part is, its past builds, and what is on the shelf',
        keywords: [
          'set counts',
          'opening stock',
          'opening balance',
          'part kind',
          'backflush',
          'past builds',
          'costs',
        ],
        permissionKey: PermissionKey.settingsManage,
      },
      {
        id: 'inventory-setup-general',
        label: 'General',
        slug: 'general',
        icon: <SlidersHorizontal />,
        description: 'Whether an order raises a build, and for which parts',
        keywords: [
          'auto-build',
          'production',
          'manufacturing',
          'orders',
          'mrp',
          'adu window',
          'lead-time factor',
          'variability',
          'retention',
          'standard cost',
          'roll',
          'revaluation',
        ],
        // What the old Settings tab was hidden behind, so an MRP-only viewer never sees this group.
        permissionKey: PermissionKey.settingsManage,
      },
      {
        id: 'inventory-setup-tariffs',
        label: 'Tariffs',
        slug: 'tariffs',
        icon: <Globe />,
        description: 'Harmonized codes by country of origin, and the rates behind them',
        keywords: ['hs code', 'hts', 'duty', 'customs', 'harmonized', 'section 301'],
        permissionKey: PermissionKey.settingsManage,
      },
    ],
  },
]

/** Slugs of the Planning group; the pages that show "Run now" in the header. */
export const INVENTORY_PLANNING_SLUGS = new Set(
  (INVENTORY_NAV.find((group) => group.id === 'inventory-plan')?.items ?? []).map(
    (item) => item.slug
  )
)
