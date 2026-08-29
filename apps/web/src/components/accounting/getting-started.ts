// apps/web/src/components/accounting/getting-started.ts
// Client-safe display catalog for the accounting module's getting-started
// checklist. Same shape and tone as the dispatch catalog
// (`~/components/dispatch/getting-started`) and the org-wide one
// (`~/components/getting-started/client`) - labels, descriptions, icons and
// CTAs (web concerns); the canonical key set + persisted state shapes come
// from @auxx/lib/getting-started/client.
//
// The six goals are deliberately COARSE - one per wizard page, not one per
// settings field (plans/money/tasks/13-accounting-ui.md section 3.2). There is
// no `connect-quickbooks` goal on purpose: decision `P1` makes "nothing
// connected" a first-class outcome, so nagging for a provider would contradict
// the design the poster rests on.

import { ACCOUNTING_GOAL_KEYS, type AccountingGoalKey } from '@auxx/lib/getting-started/client'
import type { GettingStartedGoal } from '~/components/getting-started/client'

const GOALS: Record<AccountingGoalKey, Omit<GettingStartedGoal, 'key'>> = {
  'set-accounting-period': {
    label: 'Set your accounting period',
    description:
      'Name the last month closed in your old system and the timezone your books are kept in. There is no UTC fallback.',
    iconId: 'calendar-clock',
    color: 'blue',
    ctaText: 'Set period',
    href: '/app/accounting/settings/general',
    docsPath: '/help/accounting/set-accounting-period',
  },
  'set-opening-balances': {
    label: 'Enter your opening balances',
    description:
      'Record the inventory you were carrying at the cutoff, and reconcile it against what your accounting provider says.',
    iconId: 'banknote',
    color: 'green',
    ctaText: 'Enter balances',
    href: '/app/accounting/settings/opening',
    docsPath: '/help/accounting/set-opening-balances',
  },
  'set-costing': {
    label: 'Set up costing',
    description:
      'Absorb labor and overhead onto every unit you assemble, then roll standard cost so each part carries a number.',
    iconId: 'calculator',
    color: 'amber',
    ctaText: 'Set up costing',
    href: '/app/accounting/settings/general',
    docsPath: '/help/accounting/set-costing',
  },
  'map-accounts': {
    label: 'Map your accounts',
    description:
      'Point each accounting role at an account in your chart. Nothing can be previewed until they are mapped.',
    iconId: 'list-checks',
    color: 'purple',
    ctaText: 'Map accounts',
    href: '/app/accounting/settings/accounts?s=roles',
    docsPath: '/help/accounting/map-accounts',
  },
  'finalize-setup': {
    label: 'Finalize your setup',
    description:
      'Freeze the opening baseline so the ledger can start. Later corrections use a reversal, never an edit.',
    iconId: 'check-circle',
    color: 'teal',
    ctaText: 'Finalize setup',
    href: '/app/accounting/settings/general',
    docsPath: '/help/accounting/finalize-setup',
  },
  'post-first-entry': {
    label: 'Close your first month',
    description:
      'Preview the month-end inventory entry, check it balances, and post it to your books.',
    iconId: 'book-open',
    color: 'indigo',
    ctaText: 'Open the ledger',
    href: '/app/accounting',
    docsPath: '/help/accounting/post-first-entry',
  },
}

/** Ordered display catalog (display order = ACCOUNTING_GOAL_KEYS order). */
export const ACCOUNTING_GETTING_STARTED_GOALS: GettingStartedGoal[] = ACCOUNTING_GOAL_KEYS.map(
  (key) => ({
    key,
    ...GOALS[key],
  })
)
