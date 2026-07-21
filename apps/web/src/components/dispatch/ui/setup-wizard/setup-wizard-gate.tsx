// apps/web/src/components/dispatch/ui/setup-wizard/setup-wizard-gate.tsx
'use client'

import type { DispatchGoalKey } from '@auxx/lib/getting-started/client'
import { FeatureKey } from '@auxx/lib/permissions/client'
import { useEffect, useState } from 'react'
import { useUser } from '~/hooks/use-user'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'
import { DispatchSetupWizard } from './dispatch-setup-wizard'

/** The three wizard must-haves — an org where all three are already done never sees the wizard. */
const WIZARD_GOAL_KEYS: readonly DispatchGoalKey[] = ['add-workers', 'set-address', 'set-hours']

/**
 * Auto-opens `DispatchSetupWizard` the first time an admin/owner visits `/app/dispatch`. Mounted
 * once from the dispatch layout — renders nothing besides the (closed, by default) dialog.
 *
 * Opens when ALL of:
 * - the dispatch checklist's `wizardCompletedAt` is `null` (never finished or skipped) and the
 *   checklist isn't dismissed
 * - the current user is ADMIN/OWNER (plain role check — never redirects, just doesn't render)
 * - `FeatureKey.dispatch` is enabled for the org
 * - the three wizard goals (workers/address/hours) aren't already all complete — an org that set
 *   everything up before the wizard shipped never sees it
 */
export function DispatchSetupWizardGate() {
  const { isAdminOrOwner } = useUser()
  const { hasAccess } = useFeatureFlags()
  const dispatchEnabled = hasAccess(FeatureKey.dispatch)
  const shouldQuery = isAdminOrOwner && dispatchEnabled

  const { data: status } = api.gettingStarted.getStatus.useQuery(
    { checklist: 'dispatch' },
    { enabled: shouldQuery }
  )

  const [open, setOpen] = useState(false)
  const [hasAutoOpened, setHasAutoOpened] = useState(false)

  const allWizardGoalsComplete =
    !!status && WIZARD_GOAL_KEYS.every((key) => status.completedGoals.includes(key))

  useEffect(() => {
    if (hasAutoOpened || !shouldQuery || !status) return
    if (status.wizardCompletedAt !== null || status.dismissed || allWizardGoalsComplete) return
    setOpen(true)
    setHasAutoOpened(true)
  }, [hasAutoOpened, shouldQuery, status, allWizardGoalsComplete])

  if (!shouldQuery) return null

  return <DispatchSetupWizard open={open} onOpenChange={setOpen} />
}
