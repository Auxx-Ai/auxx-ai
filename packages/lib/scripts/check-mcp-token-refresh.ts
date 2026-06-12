// packages/lib/scripts/check-mcp-token-refresh.ts
// One-off check: force-expire the Stripe MCP credential, then exercise the lazy refresh path.
// Run from apps/worker: npx dotenv -e ../../.env -- node --conditions source --import tsx/esm ../../packages/lib/scripts/check-mcp-token-refresh.ts

import { database as db, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { testMcpTool } from '../src/ai/mcp/test-tool'

const organizationId = process.argv[2] ?? 'abgwpa1l81reht2zmwrcihfu'
const serverId = process.argv[3] ?? 'qxd28mjsqakvuadbp9jg3zgh'

const [before] = await db
  .select({
    id: schema.Credential.id,
    expiresAt: schema.Credential.expiresAt,
    lastRefreshAt: schema.Credential.lastRefreshAt,
  })
  .from(schema.Credential)
  .where(eq(schema.Credential.mcpServerId, serverId))
if (!before) throw new Error('No credential found')

// Force-expire so the lazy path must refresh.
await db
  .update(schema.Credential)
  .set({ expiresAt: new Date(Date.now() - 60_000) })
  .where(eq(schema.Credential.id, before.id))
console.log('forced expiresAt to past for', before.id)

const result = await testMcpTool({
  organizationId,
  userId: 'script-check',
  serverId,
  toolName: 'search_stripe_documentation',
  args: { question: 'How do refunds work?' },
})

const [after] = await db
  .select({
    expiresAt: schema.Credential.expiresAt,
    lastRefreshAt: schema.Credential.lastRefreshAt,
    failures: schema.Credential.consecutiveRefreshFailures,
  })
  .from(schema.Credential)
  .where(eq(schema.Credential.id, before.id))

console.log(
  JSON.stringify(
    {
      call: result.ok
        ? { ok: true, isError: result.isError, durationMs: result.durationMs }
        : result,
      credential: after,
    },
    null,
    2
  )
)
process.exit(result.ok ? 0 : 1)
