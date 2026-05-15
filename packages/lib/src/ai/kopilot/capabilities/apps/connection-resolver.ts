// packages/lib/src/ai/kopilot/capabilities/apps/connection-resolver.ts

import { database as defaultDb, schema } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'

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
  db?: typeof defaultDb
}): Promise<{ present: boolean; expiresAt: Date | null }> {
  const { orgId, userId, appId, scope } = input
  const db = input.db ?? defaultDb

  // Autonomous policy: user-scope tools are hidden when there's no human in the loop.
  if (scope === 'user' && !userId) {
    return { present: false, expiresAt: null }
  }

  const baseConditions = [
    eq(schema.WorkflowCredentials.appId, appId),
    eq(schema.WorkflowCredentials.organizationId, orgId),
    eq(schema.WorkflowCredentials.type, 'app-connection'),
  ]
  const where =
    scope === 'organization'
      ? and(...baseConditions, isNull(schema.WorkflowCredentials.userId))
      : and(...baseConditions, eq(schema.WorkflowCredentials.userId, userId as string))

  const row = await db.query.WorkflowCredentials.findFirst({
    where,
    columns: { expiresAt: true },
  })

  if (!row) return { present: false, expiresAt: null }
  return { present: true, expiresAt: row.expiresAt }
}
