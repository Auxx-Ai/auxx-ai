// apps/web/src/app/(protected)/app/agents/new/page.tsx
'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/**
 * Legacy /new route. Agent creation moved to a direct mutate-and-push from
 * the list page's "Create agent" button (no dialog, no /new surface). This
 * page now just bounces back to the list — any old links still resolve.
 */
export default function AgentNewPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/app/agents')
  }, [router])
  return null
}
