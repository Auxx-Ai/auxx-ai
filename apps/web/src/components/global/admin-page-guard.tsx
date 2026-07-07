// apps/web/src/components/global/admin-page-guard.tsx
'use client'

import { useUser } from '~/hooks/use-user'

/**
 * Drop-in guard for admin-only pages rendered by server components: redirects
 * non-admin members to /access-denied (via useUser's requireRoles). Renders nothing.
 */
export function AdminPageGuard() {
  useUser({ requireRoles: ['ADMIN', 'OWNER'] })
  return null
}
