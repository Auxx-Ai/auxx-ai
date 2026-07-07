// apps/web/src/components/mail-permissions/ui/enterprise-gate.tsx
'use client'

import { FeatureKey } from '@auxx/lib/types'
import { Badge } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import { Lock } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { LimitReachedDialog } from '~/components/subscriptions/limit-reached-dialog'
import { useFeatureFlags } from '~/providers/feature-flag-provider'

/** True when the org lacks the mail-permissions enterprise feature. */
export function useMailPermissionsGated(): boolean {
  const { hasAccess } = useFeatureFlags()
  return !hasAccess(FeatureKey.mailPermissions)
}

/** The shared upgrade prompt for gated mail-permission controls. */
export function MailPermissionsUpgradeDialog({
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
      title='Mail permissions'
      description='Inbox access levels, conversation sharing, and manager delegation are available on the Enterprise plan.'
    />
  )
}

/**
 * Tease-with-upgrade gating (UI plan decision 4): when the org lacks
 * `FeatureKey.mailPermissions`, children render disabled with a small
 * "Enterprise" badge, and any click opens the upgrade dialog. Never hides.
 */
export function EnterpriseGate({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  const gated = useMailPermissionsGated()
  const [upgradeOpen, setUpgradeOpen] = useState(false)

  if (!gated) return <>{children}</>

  return (
    <>
      <div className={cn('relative inline-flex items-center gap-1.5', className)}>
        <div aria-disabled className='pointer-events-none opacity-60'>
          {children}
        </div>
        <Badge variant='outline' className='pointer-events-none text-[10px]'>
          Enterprise
        </Badge>
        <button
          type='button'
          aria-label='Mail permissions — available on the Enterprise plan'
          className='absolute inset-0 cursor-pointer'
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setUpgradeOpen(true)
          }}
        />
      </div>
      <MailPermissionsUpgradeDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} />
    </>
  )
}
