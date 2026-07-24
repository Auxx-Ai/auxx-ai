// apps/web/src/components/global/capability-page-guard.tsx
'use client'

import { usePathname, useRouter } from 'next/navigation'
import { type ReactNode, useEffect } from 'react'
import { NoAccess } from '~/components/permissions/ui/no-access'
import { useAccess } from '~/providers/capabilities-provider'

interface CapabilityPageGuardProps {
  permissionKey: string
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
  const router = useRouter()
  const pathname = usePathname()
  const { can, isLoading } = useAccess()

  useEffect(() => {
    if (children !== undefined) return
    // Skip for auth pages (mirrors useUser's role-guard bail-out).
    if (pathname === '/login' || pathname === '/register' || pathname === '/forgot-password') return
    if (!isLoading && !can(permissionKey)) router.push('/access-denied')
  }, [can, children, isLoading, permissionKey, pathname, router])

  if (children !== undefined) {
    if (isLoading) return null
    if (!can(permissionKey)) return <NoAccess area={area} />
    return children
  }
  return null
}
