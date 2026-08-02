// apps/kb/src/server/kb-access.ts

import { WEBAPP_URL } from '@auxx/config/urls'
import { isOrgMember } from '@auxx/lib/cache'
// Deep subpaths on purpose: `@auxx/lib/permissions` (the barrel) also re-exports
// `overage-handler` → `NotificationService` → `../realtime`, which would drag
// realtime + queue dependencies this satellite app does not have into the KB
// bundle. `get-capabilities`' and `article-read-access`' own graphs are cache +
// capability modules only.
import { canReadKnowledgeBase } from '@auxx/lib/permissions/capabilities/article-read-access'
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
 *
 * 🔴 The predicate itself is NOT written here any more (plan v3/06 P5,
 * implementation I3). `canReadKnowledgeBase` in
 * `@auxx/lib/permissions/capabilities/article-read-access` is the one authoring
 * point, shared with the Kopilot KB tools, the article SSE route, the attachment
 * gate and the knowledge-source guard. This app's job is to supply the viewer.
 *
 * ⚠ It is one notch stricter than the bare `canViewInstance` it replaced: a
 * `kind: 'source'` KB is never readable, whatever the grants say. Source KBs are
 * hidden `KnowledgeSource` containers that this app was never meant to render —
 * `listKnowledgeBases`' own comment says "never surfaced in KB lists, pickers,
 * **or the public site**" — so this closes the gap rather than narrowing a
 * feature.
 */
export const canViewKB = cache(
  async (kbId: string, organizationId: string, userId: string): Promise<boolean> => {
    const capabilities = await getCapabilities(userId, organizationId)
    return canReadKnowledgeBase(organizationId, capabilities, kbId)
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
