// packages/lib/src/ai/kopilot/capabilities/apps/connection-resolver.ts

import { findCredential } from '@auxx/credentials/store'

/**
 * Registration-time presence check for an app connection. **Does not decrypt.**
 *
 * Decryption stays in `resolveAppConnectionForRuntime` and only runs at
 * execution time — the same path workflow blocks use. The bridge calls this
 * helper purely to decide whether to register a tool with the LLM in the
 * first place (decision A4 — "hidden when no connection").
 *
 * Org-scope presence is usually answered off the cached `installedApps`
 * row (decision B2). This direct helper is the user-scope path (decision G2)
 * and the fallback for the org path before the provider extension is wired.
 *
 * See plans/kopilot/apps/credentials.md §3.1.
 */
export async function getAppConnectionPresence(input: {
  orgId: string
  /** Human invoker. null on autonomous runs. Never an agent userId. */
  userId: string | null
  appId: string
  scope: 'user' | 'organization'
}): Promise<{ present: boolean; expiresAt: Date | null }> {
  const { orgId, userId, appId, scope } = input

  // Autonomous policy: user-scope tools are hidden when there's no human in the loop.
  if (scope === 'user' && !userId) {
    return { present: false, expiresAt: null }
  }

  const result = await findCredential({
    organizationId: orgId,
    kind: 'app',
    appId,
    userId: scope === 'organization' ? null : (userId as string),
  })

  if (result.isErr() || !result.value) {
    return { present: false, expiresAt: null }
  }
  return { present: true, expiresAt: result.value.expiresAt }
}
