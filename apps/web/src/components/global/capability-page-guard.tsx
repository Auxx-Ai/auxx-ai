// apps/web/src/components/global/capability-page-guard.tsx
'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useAccess } from '~/providers/capabilities-provider'

/**
 * Drop-in guard for capability-gated settings pages: redirects members who do
 * NOT hold `permissionKey` to /access-denied. The capability-check twin of
 * {@link AdminPageGuard} — ADMIN/OWNER hold every key via `ROLE_DEFAULTS`, so
 * they pass, while a granted non-admin is let through. Renders nothing.
 */
export function CapabilityPageGuard({ permissionKey }: { permissionKey: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const { can, isLoading } = useAccess()

  useEffect(() => {
    // Skip for auth pages (mirrors useUser's role-guard bail-out).
    if (pathname === '/login' || pathname === '/register' || pathname === '/forgot-password') return
    if (!isLoading && !can(permissionKey)) router.push('/access-denied')
  }, [can, isLoading, permissionKey, pathname, router])

  return null
}
