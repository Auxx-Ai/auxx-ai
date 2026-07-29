// apps/web/src/components/global/capability-page-guard.tsx
'use client'

import type { PermissionKey } from '@auxx/lib/permissions/client'
import type { ReactNode } from 'react'
import { NoAccess } from '~/components/permissions/ui/no-access'
import { useAccess, useRequireCapability } from '~/providers/capabilities-provider'

interface CapabilityPageGuardProps {
  permissionKey: PermissionKey | string
  /**
   * When provided, the guard owns the protected subtree and prevents it from
   * mounting while denied. Existing marker-style callers without children keep
   * the legacy redirect behavior.
   */
  children?: ReactNode
  /** Friendly area name for the inline denied surface. */
  area?: string
}

/**
 * Drop-in guard for capability-gated pages. Marker-style usage redirects denied
 * members to `/access-denied`; wrapper usage prevents protected children from
 * mounting and renders {@link NoAccess}. ADMIN/OWNER hold every key via
 * `ROLE_DEFAULTS`, while a granted non-admin is let through.
 */
export function CapabilityPageGuard({ permissionKey, children, area }: CapabilityPageGuardProps) {
  const { can, isLoading } = useAccess()
  // Wrapper usage renders `NoAccess` in place instead of navigating away.
  useRequireCapability(permissionKey, children === undefined)

  if (children !== undefined) {
    if (isLoading) return null
    if (!can(permissionKey)) return <NoAccess area={area} />
    return children
  }
  return null
}
