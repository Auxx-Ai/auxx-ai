// apps/web/src/components/global/admin-gate.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { cloneElement, type ReactElement } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { useUser } from '~/hooks/use-user'

/**
 * Role gate for admin-only UI actions. Returns whether the viewer may act plus a
 * tooltip-text helper for controls that manage their own `disabled` prop (menu
 * items, switches). Pass `allow` to override the role check for resource-scoped
 * exceptions (e.g. the owner of a personal channel).
 */
export function useAdminGate(allow?: boolean) {
  const { isAdminOrOwner, userId } = useUser()
  const allowed = allow ?? isAdminOrOwner
  return {
    allowed,
    isAdminOrOwner,
    userId,
    gateTooltip: (action: string) => (allowed ? undefined : `Only admins can ${action}`),
  }
}

interface AdminGateProps {
  /** Verb phrase completing "Only admins can …" (e.g. "manage shared channels"). */
  action: string
  /** Overrides the role check (e.g. personal-channel owners). Defaults to isAdminOrOwner. */
  allow?: boolean
  children: ReactElement<{ disabled?: boolean; className?: string }>
}

/**
 * Disables its single child control and shows an explanatory tooltip when the
 * viewer lacks admin rights. The wrapper span carries hover/focus because
 * disabled elements swallow pointer events.
 */
export function AdminGate({ action, allow, children }: AdminGateProps) {
  const { allowed } = useAdminGate(allow)
  if (allowed) return children
  return (
    <Tooltip content={`Only admins can ${action}`}>
      <span className='inline-flex cursor-not-allowed' tabIndex={0}>
        {cloneElement(children, {
          disabled: true,
          className: cn(children.props.className, 'pointer-events-none'),
        })}
      </span>
    </Tooltip>
  )
}
