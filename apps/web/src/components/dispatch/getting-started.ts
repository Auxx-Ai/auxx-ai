// apps/web/src/components/dispatch/getting-started.ts
// Client-safe display catalog for the dispatch module's getting-started
// checklist. Same shape and tone as the org-wide catalog
// (`~/components/getting-started/client`) — labels, descriptions, icons and
// CTAs (web concerns); the canonical key set + persisted state shapes come
// from @auxx/lib/getting-started/client.

import { DISPATCH_GOAL_KEYS, type DispatchGoalKey } from '@auxx/lib/getting-started/client'
import type { GettingStartedGoal } from '~/components/getting-started/client'

const GOALS: Record<DispatchGoalKey, Omit<GettingStartedGoal, 'key'>> = {
  'add-workers': {
    label: 'Add your workers',
    description: 'Bring your field team into Auxx so you can assign and schedule their work.',
    iconId: 'user-plus',
    color: 'green',
    ctaText: 'Add workers',
    href: '/app/dispatch/settings/workers',
    docsPath: '/help/dispatch/add-workers',
  },
  'set-address': {
    label: 'Set your business address',
    description: 'Add your business address so routes and schedules start from the right place.',
    iconId: 'map-pin',
    color: 'blue',
    ctaText: 'Set address',
    href: '/app/dispatch/settings/general',
    docsPath: '/help/dispatch/set-address',
  },
  'set-hours': {
    label: 'Set operating hours',
    description: 'Define when your team is available so the board and planner respect them.',
    iconId: 'clock',
    color: 'amber',
    ctaText: 'Set hours',
    href: '/app/dispatch/settings/scheduling',
    docsPath: '/help/dispatch/set-hours',
  },
  'add-product': {
    label: 'Add a product or service',
    description: 'Build the catalog your quotes and invoices pull their line items from.',
    iconId: 'package',
    color: 'orange',
    ctaText: 'Add a product',
    href: '/app/dispatch/settings/products',
    docsPath: '/help/dispatch/add-product',
  },
  'set-tax-rate': {
    label: 'Set a default tax rate',
    description: 'Apply the right tax to new quote and invoice lines without picking it each time.',
    iconId: 'percent',
    color: 'pink',
    ctaText: 'Set tax rate',
    href: '/app/dispatch/settings/products?s=tax-rates',
    docsPath: '/help/dispatch/set-tax-rate',
  },
  'create-request': {
    label: 'Log a service request',
    description: 'Capture a customer request so it can be turned into scheduled work.',
    iconId: 'clipboard-list',
    color: 'teal',
    ctaText: 'New service request',
    href: '/app/service-requests',
    docsPath: '/help/dispatch/create-request',
  },
  'create-work-order': {
    label: 'Create a work order',
    description: 'Turn a request into a work order your team can be assigned and dispatched to.',
    iconId: 'wrench',
    color: 'purple',
    ctaText: 'New work order',
    href: '/app/work-orders',
    docsPath: '/help/dispatch/create-work-order',
  },
  'schedule-visit': {
    label: 'Schedule a visit',
    description: 'Put a job on the board and see your dispatch workflow come together.',
    iconId: 'calendar-clock',
    color: 'indigo',
    ctaText: 'Open dispatch board',
    href: '/app/dispatch',
    docsPath: '/help/dispatch/schedule-visit',
  },
}

/** Ordered display catalog (display order = DISPATCH_GOAL_KEYS order). */
export const DISPATCH_GETTING_STARTED_GOALS: GettingStartedGoal[] = DISPATCH_GOAL_KEYS.map(
  (key) => ({
    key,
    ...GOALS[key],
  })
)
