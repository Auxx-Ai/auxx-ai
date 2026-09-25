// apps/web/src/components/mrp/manage-nav.tsx

import { FeatureKey, PermissionKey } from '@auxx/lib/permissions/client'
import {
  Calculator,
  Flag,
  Globe,
  History,
  ListChecks,
  SlidersHorizontal,
  Table2,
  Truck,
} from 'lucide-react'
import type { SidebarProps } from '~/constants/menu'

/** Base URL of the Parts > Manage segment; every rail row is `${MANAGE_BASE_URL}/${slug}`. */
export const MANAGE_BASE_URL = '/app/parts/manage'

/**
 * The Manage rail (plans/mrp/07-ui-plan.md §3). Flat slugs: the groups are rail
 * labels, not path segments. `useSettingsMenu` drops a group once every row is
 * filtered out, so a buyer with `mrp.view` sees only MRP and an admin without the
 * MRP feature sees only Parts & Services.
 */
export const MANAGE_NAV: SidebarProps[] = [
  {
    id: 'manage-parts',
    label: 'Parts & Services',
    type: 'header',
    items: [
      {
        id: 'manage-parts-general',
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
        ],
        // What the old Settings tab was hidden behind, so an MRP-only viewer never sees this group.
        permissionKey: PermissionKey.settingsManage,
      },
      {
        id: 'manage-parts-tariffs',
        label: 'Tariffs',
        slug: 'tariffs',
        icon: <Globe />,
        description: 'Harmonized codes by country of origin, and the rates behind them',
        keywords: ['hs code', 'hts', 'duty', 'customs', 'harmonized', 'section 301'],
        permissionKey: PermissionKey.settingsManage,
      },
      {
        id: 'manage-parts-costing',
        label: 'Costing',
        slug: 'costing',
        icon: <Calculator />,
        description: 'What a part is valued at, and what was on the shelf on day one',
        keywords: [
          'standard cost',
          'roll',
          'opening stock',
          'opening balance',
          'revaluation',
          'part kind',
        ],
        permissionKey: PermissionKey.settingsManage,
      },
    ],
  },
  {
    id: 'manage-mrp',
    label: 'MRP',
    type: 'header',
    items: [
      {
        id: 'manage-mrp-plan',
        label: 'Action list',
        slug: 'plan',
        icon: <ListChecks />,
        description: 'What to order or build now, from the latest plan run',
        keywords: ['mrp', 'reorder', 'suggestions', 'buy', 'build', 'purchase order'],
        permissionKey: PermissionKey.mrpView,
        featureKey: FeatureKey.mrp,
      },
      {
        id: 'manage-mrp-suppliers',
        label: 'Suppliers',
        slug: 'suppliers',
        icon: <Truck />,
        description: 'Each supplier’s next order and how reliably it delivers',
        keywords: ['vendor', 'order cycle', 'next order', 'lead time'],
        permissionKey: PermissionKey.mrpView,
        featureKey: FeatureKey.mrp,
      },
      {
        id: 'manage-mrp-all-parts',
        label: 'All parts',
        slug: 'all-parts',
        icon: <Table2 />,
        description: 'Every part in the run, with its usage, cover and buffer',
        keywords: ['days of cover', 'adu', 'buffer', 'grid'],
        permissionKey: PermissionKey.mrpView,
        featureKey: FeatureKey.mrp,
      },
      {
        id: 'manage-mrp-flags',
        label: 'Flags',
        slug: 'flags',
        icon: <Flag />,
        description: 'Parts the plan could not size with confidence',
        keywords: ['warnings', 'data quality', 'missing lead time'],
        permissionKey: PermissionKey.mrpView,
        featureKey: FeatureKey.mrp,
      },
      {
        id: 'manage-mrp-runs',
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
]
