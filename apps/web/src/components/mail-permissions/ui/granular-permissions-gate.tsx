// apps/web/src/components/mail-permissions/ui/granular-permissions-gate.tsx
'use client'

import { FeatureKey } from '@auxx/lib/types'
import { Badge } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import { Lock } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { LimitReachedDialog } from '~/components/subscriptions/limit-reached-dialog'
import { useFeatureFlags } from '~/providers/feature-flag-provider'

/**
 * True when the org lacks `FeatureKey.granularPermissions` — the ONE key gating
 * the whole permission layer since plan v3/03 §7.6 (D9) retired
 * `FeatureKey.mailPermissions` onto it.
 *
 * Was `useMailPermissionsGated`. The key is **Growth+**, not Enterprise-only, so
 * neither the hook nor the wrapper below may keep saying "Enterprise" — the copy
 * would send a paying Growth customer to the sales page for a feature they own.
 */
export function useGranularPermissionsGated(): boolean {
  const { hasAccess } = useFeatureFlags()
  return !hasAccess(FeatureKey.granularPermissions)
}

/** The shared upgrade prompt for gated permission controls. */
export function GranularPermissionsUpgradeDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <LimitReachedDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={Lock}
      title='Granular permissions'
      description='Inbox access levels, conversation sharing, manager delegation and per-member capability grants are available from the Growth plan up.'
    />
  )
}

/**
 * Tease-with-upgrade gating (UI plan decision 4): when the org lacks
 * `FeatureKey.granularPermissions`, children render disabled with a small
 * "Upgrade" badge, and any click opens the upgrade dialog. Never hides.
 *
 * The badge is deliberately plan-AGNOSTIC. It used to read "Enterprise", which
 * was already the wrong tier for `granularPermissions` (Growth+) and would go
 * wrong again on the next matrix change; the dialog is the one place that names a
 * plan.
 */
export function GranularPermissionsGate({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  const gated = useGranularPermissionsGated()
  const [upgradeOpen, setUpgradeOpen] = useState(false)

  if (!gated) return <>{children}</>

  return (
    <>
      <div className={cn('relative inline-flex items-center gap-1.5', className)}>
        <div aria-disabled className='pointer-events-none opacity-60'>
          {children}
        </div>
        <Badge variant='outline' className='pointer-events-none text-[10px]'>
          Upgrade
        </Badge>
        <button
          type='button'
          aria-label='Granular permissions — available on a higher plan'
          className='absolute inset-0 cursor-pointer'
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setUpgradeOpen(true)
          }}
        />
      </div>
      <GranularPermissionsUpgradeDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} />
    </>
  )
}
