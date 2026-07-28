// apps/kb/src/server/kb-access.ts

import { WEBAPP_URL } from '@auxx/config/urls'
import { isOrgMember } from '@auxx/lib/cache'
// Deep subpath on purpose: `@auxx/lib/permissions` (the barrel) also re-exports
// `overage-handler` → `NotificationService` → `../realtime`, which would drag
// realtime + queue dependencies this satellite app does not have into the KB
// bundle. `get-capabilities`' own graph is cache + capability modules only.
import { getCapabilities } from '@auxx/lib/permissions/capabilities/get-capabilities'
import { redirect } from 'next/navigation'
import { cache } from 'react'

/**
 * Whether `userId` may READ the INTERNAL knowledge base `kbId` — the single
 * per-instance predicate this app has (`kb` is an `INSTANCE_ACCESS_RESOURCES`
 * key, so an explicit `ResourceAccess` row, including `permission: 'none'`,
 * beats the coarse `knowledgeBase` area level).
 *
 * This SUBSUMES the `isOrgMember` check it replaced: a non-member has no
 * `memberRoleMap` entry, so `getCapabilities` composes an empty blob at role
 * `USER`, the `knowledgeBase` area resolves to `Level.None`, and
 * `effectiveInstanceLevel` returns `undefined` → denied.
 *
 * Deliberately NOT feature-gated (no `FeatureKey.knowledgeBase` check): a plan
 * downgrade must not dark an already-published internal KB mid billing cycle.
 * Same posture as the other read-only capability call sites.
 *
 * Memoized with React `cache()` — the layout gate, the page gate and the
 * `loadKBPayload` chokepoint would otherwise each resolve capabilities on a
 * single internal render. Outside a React request scope (route handlers)
 * `cache()` degrades to a plain call, which is still correct.
 *
 * apps/kb is read-only; there is no authoring surface here, so `canEditInstance`
 * has no meaning in this app and must not be added for symmetry.
 */
export const canViewKB = cache(
  async (kbId: string, organizationId: string, userId: string): Promise<boolean> => {
    const capabilities = await getCapabilities(userId, organizationId)
    return capabilities.canViewInstance('kb', kbId)
  }
)

/**
 * Redirect a denied visitor to the web app's no-access screen, picking the
 * wording that matches who they actually are.
 *
 * The membership read here is **not** the gate — {@link canViewKB} already
 * denied. It only chooses between two denial strings, because one boolean
 * merges two populations: a member restricted from this specific KB (tell them
 * to ask an admin for access) and a stranger holding a live KB session from
 * another org on the shared host (tell them they're not in the org). Getting
 * this wrong can only show the wrong copy — it cannot reopen the hole.
 *
 * HTML surfaces only. `search.json`, `.md` and `/r/<id>` keep an opaque
 * `404`/`403`: they have no UI to explain anything, and a distinguishable
 * response would confirm the KB's existence to a non-member.
 */
export async function kbDenialRedirect(organizationId: string, userId: string): Promise<never> {
  const member = await isOrgMember(organizationId, userId)
  redirect(`${WEBAPP_URL}/kb-auth/no-access${member ? '?reason=restricted' : ''}`)
}
