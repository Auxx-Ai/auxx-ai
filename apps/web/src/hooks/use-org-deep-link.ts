// hooks/use-org-deep-link.ts

import type { DehydratedOrganization } from '@auxx/lib/dehydration'
import { useEffect } from 'react'

/**
 * Reads the `auxx-org-handle` cookie set by the proxy and triggers an org
 * switch via the existing client-side flow. The cookie is cleared immediately
 * after reading so the switch only fires once.
 */
export function useOrgDeepLink(
  currentOrgId: string | undefined,
  organizations: DehydratedOrganization[],
  switchOrganization: (orgId: string) => void
) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally run once on mount
  useEffect(() => {
    const cookie = document.cookie.split('; ').find((c) => c.startsWith('auxx-org-handle='))
    if (!cookie) return

    const handle = cookie.split('=')[1]

    // Clear cookie immediately
    // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API has limited browser support
    document.cookie = 'auxx-org-handle=; max-age=0; path=/'

    if (!handle) return

    const targetOrg = organizations.find((o) => o.handle === handle)
    if (!targetOrg || targetOrg.id === currentOrgId) return

    switchOrganization(targetOrg.id)
  }, [])
}
