// apps/web/src/components/global/capability-gate.tsx
'use client'

import type { PermissionKey } from '@auxx/lib/permissions/client'
import { cn } from '@auxx/ui/lib/utils'
import { cloneElement, type ReactElement } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { useUser } from '~/hooks/use-user'
import { useAccess } from '~/providers/capabilities-provider'

/**
 * Capability gate for permission-gated UI actions — the replacement for
 * `useAdminGate` (plan 39 §4.1). Returns whether the viewer may act plus a
 * tooltip-text helper for controls that manage their own `disabled` prop (menu
 * items, switches).
 *
 * `allow` overrides the capability check for resource-scoped exceptions — the
 * owner of a personal channel acting on their own channel, say. It is a real
 * carve-out, not legacy: the area key answers "may you manage shared things",
 * which is the wrong question for something you own.
 *
 * `held` is the raw capability answer with `allow` NOT applied, for callers that
 * compose it themselves (`held || isMine`). Server enforces; this is
 * degrade-only, so it deliberately does not wait on `isLoading` — an unseeded
 * snapshot fails closed, which for a hide/disable gate is the safe direction.
 */
export function useCapabilityGate(key: PermissionKey | string, allow?: boolean) {
  const { can } = useAccess()
  const { userId } = useUser()
  const held = can(key)
  return {
    allowed: allow ?? held,
    held,
    userId,
    gateTooltip: (action: string) =>
      (allow ?? held) ? undefined : `You do not have permission to ${action}`,
  }
}

interface CapabilityGateProps {
  /** Verb phrase completing "You do not have permission to …" (e.g. "manage shared channels"). */
  action: string
  /** The capability the action requires. */
  permissionKey: PermissionKey | string
  /** Overrides the capability check (e.g. personal-channel owners). */
  allow?: boolean
  children: ReactElement<{ disabled?: boolean; className?: string }>
}

/**
 * Disables its single child control and shows an explanatory tooltip when the
 * viewer lacks the capability. The wrapper span carries hover/focus because
 * disabled elements swallow pointer events.
 *
 * The copy says "you do not have permission", not "only admins can" — after the
 * leveled model an admin whose profile narrowed lands here too, and the old
 * wording told them something false.
 */
export function CapabilityGate({ action, permissionKey, allow, children }: CapabilityGateProps) {
  const { allowed } = useCapabilityGate(permissionKey, allow)
  if (allowed) return children
  return (
    <Tooltip content={`You do not have permission to ${action}`}>
      <span className='inline-flex cursor-not-allowed' tabIndex={0}>
        {cloneElement(children, {
          disabled: true,
          className: cn(children.props.className, 'pointer-events-none'),
        })}
      </span>
    </Tooltip>
  )
}
