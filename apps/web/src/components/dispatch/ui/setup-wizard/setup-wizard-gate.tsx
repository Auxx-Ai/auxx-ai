// apps/web/src/components/dispatch/ui/setup-wizard/setup-wizard-gate.tsx
'use client'

import type { DispatchGoalKey } from '@auxx/lib/getting-started/client'
import { FeatureKey } from '@auxx/lib/permissions/client'
import { useQueryState } from 'nuqs'
import { useEffect, useState } from 'react'
import { useUser } from '~/hooks/use-user'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'
import { DispatchSetupWizard } from './dispatch-setup-wizard'

/**
 * The three wizard must-haves — an org where all three are already done never sees the wizard.
 * Deliberately NOT extended with the pricing goals (`add-product`, `set-tax-rate`) the wizard
 * gained later: this list is the "already running on dispatch" escape hatch, and an org that has
 * workers, an address and hours is running whether or not it keeps a catalog. Adding them here
 * would auto-open a modal over an established board.
 */
const WIZARD_GOAL_KEYS: readonly DispatchGoalKey[] = ['add-workers', 'set-address', 'set-hours']

/**
 * Auto-opens `DispatchSetupWizard` the first time an admin/owner visits `/app/dispatch`. Mounted
 * once from the dispatch layout — renders nothing besides the (closed, by default) dialog.
 *
 * Opens when ALL of:
 * - the dispatch checklist's `wizardCompletedAt` is `null` (never finished or skipped) and the
 *   checklist isn't dismissed — read from FRESH status only, never a stale cache entry
 * - the current user is ADMIN/OWNER (plain role check — never redirects, just doesn't render)
 * - `FeatureKey.dispatch` is enabled for the org
 * - the three wizard goals (workers/address/hours) aren't already all complete — an org that set
 *   everything up before the wizard shipped never sees it
 *
 * `/app/dispatch?setup=wizard` opens it regardless of all of the above except the role and
 * feature checks — the only way back into the wizard once it's been finished or skipped, and the
 * only way to see it at all on an org that already satisfies the three goals.
 */
export function DispatchSetupWizardGate() {
  const { isAdminOrOwner } = useUser()
  const { hasAccess } = useFeatureFlags()
  const dispatchEnabled = hasAccess(FeatureKey.dispatch)
  const shouldQuery = isAdminOrOwner && dispatchEnabled

  // `isStale` is the load-bearing bit: the gate unmounts whenever you leave `/app/dispatch`, so a
  // `getStatus` invalidation issued while you're away only MARKS the entry invalid (react-query
  // refetches active queries only). Coming back, the remounted gate is handed that stale
  // `wizardCompletedAt: null` synchronously and would auto-open before the refetch lands.
  const { data: status, isStale } = api.gettingStarted.getStatus.useQuery(
    { checklist: 'dispatch' },
    { enabled: shouldQuery }
  )

  const [setupParam] = useQueryState('setup')
  const [open, setOpen] = useState(false)
  const [hasAutoOpened, setHasAutoOpened] = useState(false)

  const allWizardGoalsComplete =
    !!status && WIZARD_GOAL_KEYS.every((key) => status.completedGoals.includes(key))

  useEffect(() => {
    if (hasAutoOpened || !shouldQuery) return
    // The explicit ask wins outright: it needs no status at all, so it works before the query
    // resolves and on an org whose goals are long since complete.
    if (setupParam === 'wizard') {
      setOpen(true)
      setHasAutoOpened(true)
      return
    }
    if (!status || isStale) return
    if (status.wizardCompletedAt !== null || status.dismissed || allWizardGoalsComplete) return
    setOpen(true)
    setHasAutoOpened(true)
  }, [hasAutoOpened, shouldQuery, setupParam, status, isStale, allWizardGoalsComplete])

  if (!shouldQuery) return null

  return <DispatchSetupWizard open={open} onOpenChange={setOpen} />
}
