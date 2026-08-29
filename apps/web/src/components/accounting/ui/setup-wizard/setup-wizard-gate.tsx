// apps/web/src/components/accounting/ui/setup-wizard/setup-wizard-gate.tsx
'use client'

import type { AccountingGoalKey } from '@auxx/lib/getting-started/client'
import { FeatureKey } from '@auxx/lib/permissions/client'
import { useQueryState } from 'nuqs'
import { useEffect, useState } from 'react'
import { useUser } from '~/hooks/use-user'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'
import { AccountingSetupWizard } from './accounting-setup-wizard'

/**
 * The setup goals - an org where all of these are already done never sees the wizard.
 *
 * 🛑 `post-first-entry` is deliberately NOT here. Closing a month is what the module is FOR, not
 * part of setting it up: an org that has finished setup but has not yet had a month to close must
 * not be handed a modal telling it to go and post something.
 */
const WIZARD_GOAL_KEYS: readonly AccountingGoalKey[] = [
  'set-accounting-period',
  'set-opening-balances',
  'set-costing',
  'map-accounts',
  'finalize-setup',
]

/**
 * Auto-opens `AccountingSetupWizard` the first time an admin/owner visits `/app/accounting`.
 * Mounted once from the accounting layout - renders nothing besides the (closed, by default)
 * dialog.
 *
 * Opens when ALL of:
 * - the accounting checklist's `wizardCompletedAt` is `null` (never finished or skipped) and the
 *   checklist is not dismissed - read from FRESH status only, never a stale cache entry
 * - the current user is ADMIN/OWNER (plain role check - never redirects, just does not render)
 * - `FeatureKey.accounting` is enabled for the org
 * - the five setup goals are not already all complete - an org that configured everything from the
 *   settings pages never sees it
 *
 * `/app/accounting?setup=wizard` opens it regardless of all of the above except the role and
 * feature checks - the only way back into the wizard once it has been finished or skipped, and the
 * only way to see it at all on an org that already satisfies the goals. That is the link
 * `AccountingChecklistPanel`'s "Set up accounting" button pushes.
 */
export function AccountingSetupWizardGate() {
  const { isAdminOrOwner } = useUser()
  const { hasAccess } = useFeatureFlags()
  const accountingEnabled = hasAccess(FeatureKey.accounting)
  const shouldQuery = isAdminOrOwner && accountingEnabled

  // `isStale` is the load-bearing bit: the gate unmounts whenever you leave `/app/accounting`, so
  // a `getStatus` invalidation issued while you are away only MARKS the entry invalid (react-query
  // refetches active queries only). Coming back, the remounted gate is handed that stale
  // `wizardCompletedAt: null` synchronously and would auto-open before the refetch lands.
  const { data: status, isStale } = api.gettingStarted.getStatus.useQuery(
    { checklist: 'accounting' },
    { enabled: shouldQuery }
  )

  const [setupParam, setSetupParam] = useQueryState('setup')
  const [open, setOpen] = useState(false)
  const [hasAutoOpened, setHasAutoOpened] = useState(false)

  const allWizardGoalsComplete =
    !!status && WIZARD_GOAL_KEYS.every((key) => status.completedGoals.includes(key))

  // The explicit ask, in its own effect and NOT behind `hasAutoOpened`. It needs no status at all,
  // so it works before the query resolves and on an org whose goals are long since complete.
  //
  // ⚠️ Separate from the auto-open branch below because this gate lives in the module LAYOUT: the
  // checklist panel opens the wizard by setting this param on a page that never unmounts, so a
  // once-only guard would make the button work exactly once per visit. The param is cleared on
  // close, which is also what keeps the URL honest after the dialog is gone.
  useEffect(() => {
    if (!shouldQuery || setupParam !== 'wizard') return
    setOpen(true)
  }, [shouldQuery, setupParam])

  useEffect(() => {
    if (hasAutoOpened || !shouldQuery || setupParam === 'wizard') return
    if (!status || isStale) return
    if (status.wizardCompletedAt !== null || status.dismissed || allWizardGoalsComplete) return
    setOpen(true)
    setHasAutoOpened(true)
  }, [hasAutoOpened, shouldQuery, setupParam, status, isStale, allWizardGoalsComplete])

  if (!shouldQuery) return null

  return (
    <AccountingSetupWizard
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next && setupParam === 'wizard') setSetupParam(null)
      }}
    />
  )
}
