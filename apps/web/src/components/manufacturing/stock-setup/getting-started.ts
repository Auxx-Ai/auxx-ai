// apps/web/src/components/manufacturing/stock-setup/getting-started.ts
// Display catalog for the `stock` checklist; keys and order come from STOCK_GOAL_KEYS.

import { STOCK_GOAL_KEYS, type StockGoalKey } from '@auxx/lib/getting-started/client'
import type { GettingStartedGoal } from '~/components/getting-started/client'
import { stockSetupHref } from './stock-setup-href'

const GOALS: Record<StockGoalKey, Omit<GettingStartedGoal, 'key'>> = {
  'check-part-kinds': {
    label: 'Check what each part is',
    description:
      'Confirm which parts are components, subassemblies and finished goods. The kind decides which inventory account a part sits in.',
    iconId: 'tags',
    color: 'blue',
    ctaText: 'Check parts',
    href: stockSetupHref('kinds'),
    docsPath: '/help/inventory/stock-setup',
  },
  'set-costs': {
    label: 'Set your part costs',
    description:
      'Give each part you buy a cost before recording past builds, so the builds are valued as they are written.',
    iconId: 'circle-dollar-sign',
    color: 'amber',
    ctaText: 'Set costs',
    href: stockSetupHref('costs'),
    docsPath: '/help/inventory/stock-setup',
  },
  'record-past-builds': {
    label: 'Record past builds',
    description:
      'Record the builds behind past sales of made parts, so their parts are used up on the right days. Or skip it and count without them.',
    iconId: 'hammer',
    color: 'purple',
    ctaText: 'Record past builds',
    href: stockSetupHref('builds'),
    docsPath: '/help/inventory/stock-setup',
  },
  'count-stock': {
    label: 'Count your stock',
    description: 'Count what is on the shelf. Parts you do not count keep their current numbers.',
    iconId: 'clipboard-check',
    color: 'green',
    ctaText: 'Count stock',
    href: stockSetupHref('count'),
    docsPath: '/help/inventory/stock-setup',
  },
}

/** Ordered display catalog (display order = STOCK_GOAL_KEYS order). */
export const STOCK_GETTING_STARTED_GOALS: GettingStartedGoal[] = STOCK_GOAL_KEYS.map((key) => ({
  key,
  ...GOALS[key],
}))
