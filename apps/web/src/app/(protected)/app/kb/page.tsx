// apps/web/src/app/(protected)/app/kb/page.tsx

import { CapabilityPageGuard } from '~/components/global/capability-page-guard'
import { KBEmptyState } from '~/components/kb/ui/dialogs/kb-empty-state'
import { KBLandingShell } from '~/components/kb/ui/landing/kb-landing-shell'
import { api } from '~/trpc/server'

export default async function KBMain() {
  // `kb.list` has no coarse assert — it returns a filtered/empty list for a None
  // member, so this server call never 403s. The guard redirects a member lacking
  // `knowledgeBase.view` to /access-denied (client-side).
  const knowledgeBases = await api.kb.list()

  if (!knowledgeBases || knowledgeBases.length === 0) {
    return (
      <>
        <CapabilityPageGuard permissionKey='knowledgeBase.view' />
        <KBEmptyState />
      </>
    )
  }

  return (
    <>
      <CapabilityPageGuard permissionKey='knowledgeBase.view' />
      <KBLandingShell />
    </>
  )
}
