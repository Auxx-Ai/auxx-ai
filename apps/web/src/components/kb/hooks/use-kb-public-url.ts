// apps/web/src/components/kb/hooks/use-kb-public-url.ts
'use client'

import {
  useDehydratedOrganization,
  useDehydratedOrganizationId,
  useEnv,
} from '~/providers/dehydrated-state-provider'

/**
 * Build the absolute public URL for a knowledge base.
 * Returns null when the kb slug or current org handle is missing.
 */
export function useKbPublicUrl(kbSlug: string | null | undefined): string | null {
  const { kbUrl } = useEnv()
  const org = useDehydratedOrganization(useDehydratedOrganizationId())
  if (!kbSlug || !org?.handle) return null
  return `${kbUrl}/${org.handle}/${kbSlug}`
}
