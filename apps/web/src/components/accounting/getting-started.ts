// apps/web/src/components/accounting/getting-started.ts
// Client-safe display catalog for the accounting module's getting-started
// checklist. Same shape and tone as the dispatch catalog
// (`~/components/dispatch/getting-started`) and the org-wide one
// (`~/components/getting-started/client`) - labels, descriptions, icons and
// CTAs (web concerns); the canonical key set + persisted state shapes come
// from @auxx/lib/getting-started/client.
//
// The goals are deliberately COARSE - one per wizard page that a person has to
// DO something on, not one per settings field (plans/money/tasks/13-accounting-ui.md
// section 3.2). There is no `connect-quickbooks` goal on purpose: decision `P1`
// makes "nothing connected" a first-class outcome, so nagging for a provider
// would contradict the design the poster rests on.
//
// 🛑 The ORDER lives in `ACCOUNTING_GOAL_KEYS` and mirrors the wizard's `PAGES`
// array. The record below is keyed, so its own order is cosmetic - it is kept
// in step anyway so a reader of this file is not misled about what the page
// renders.

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
  'route-payment-rails': {
    label: 'Route your payment rails',
    description:
      'Give each card rail on your orders its own clearing account, so a payout can drain it and the balance means something.',
    iconId: 'credit-card',
    color: 'pink',
    ctaText: 'Route rails',
    href: '/app/accounting/settings/payment-gateways',
    docsPath: '/help/accounting/route-payment-rails',
  },
  'set-opening-balances': {
    label: 'Set your opening balances',
    description:
      'What every account in your chart was worth at the cutoff, inventory included, as one balanced entry. Fill it from your accounting system, or say your books start from nothing.',
    iconId: 'equal',
    color: 'green',
    ctaText: 'Set opening balances',
    href: '/app/accounting/settings/opening',
    docsPath: '/help/accounting/set-opening-balances',
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
