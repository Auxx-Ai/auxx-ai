// packages/lib/scripts/verify-channel-token-resolver.ts
// Verification gate (channels-onto-connections HANDOFF §"Verification gate"):
//   1. Channel tokens are served by the unified resolver (resolveConnectionForRuntime
//      via getChannelAccessToken) — proves the new read path, NOT the stored-token fallback.
//   2. With --refresh: force-expire the credential, then confirm lazy refresh recovers it
//      (new future expiry + rotated access token).
//
// Read-only by default. The --refresh pass mutates a live credential's expiresAt and
// rotates its access token via the real refresh_token grant (self-healing; non-destructive
// to the Google/Graph grant). Pass --refresh to run it.
//
// Run (must use the worker source-condition runtime — plain tsx reads stale dist):
//   npx dotenv -- node --conditions source --import tsx/esm \
//     packages/lib/scripts/verify-channel-token-resolver.ts [--refresh] [--id <integrationId>]

import { createHash } from 'node:crypto'
import { revealSecrets, updateCredential } from '@auxx/credentials/store'
import { closePools, database as db, schema } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'
import { resolveConnectionForRuntime } from '../src/connections/resolve-connection-for-runtime'
import { getChannelAccessToken } from '../src/providers/channel-token-accessor'

/* eslint-disable no-console */

const args = process.argv.slice(2)
const doRefresh = args.includes('--refresh')
const idFlag = args.indexOf('--id')
const onlyId = idFlag >= 0 ? args[idFlag + 1] : undefined

function tokenHash(t: string | null | undefined): string {
  if (!t) return '<none>'
  return createHash('sha256').update(t).digest('hex').slice(0, 12)
}

async function readCred(credentialId: string, organizationId: string) {
  const revealed = await revealSecrets<{
    accessToken?: string | null
    refreshToken?: string | null
  }>(credentialId, organizationId)
  const [row] = await db
    .select({ expiresAt: schema.Credential.expiresAt })
    .from(schema.Credential)
    .where(eq(schema.Credential.id, credentialId))
    .limit(1)
  if (revealed.isErr()) return { ok: false as const, error: revealed.error.message }
  return {
    ok: true as const,
    accessHash: tokenHash(revealed.value.secrets.accessToken),
    hasRefresh: !!revealed.value.secrets.refreshToken,
    expiresAt: row?.expiresAt ?? null,
  }
}

async function main(): Promise<void> {
  // Linked, OAuth-backed, enabled channels (the unified resolver only serves FK-linked creds).
  const channels = await db
    .select({
      id: schema.Integration.id,
      provider: schema.Integration.provider,
      email: schema.Integration.email,
      enabled: schema.Integration.enabled,
      credentialId: schema.Integration.credentialId,
      organizationId: schema.Integration.organizationId,
      providerKey: schema.ConnectionDefinition.providerKey,
      connectionType: schema.ConnectionDefinition.connectionType,
    })
    .from(schema.Integration)
    .innerJoin(schema.Credential, eq(schema.Credential.id, schema.Integration.credentialId))
    .innerJoin(
      schema.ConnectionDefinition,
      eq(schema.ConnectionDefinition.id, schema.Credential.connectionDefinitionId)
    )
    .where(isNull(schema.Integration.deletedAt))

  const candidates = channels
    .filter((c) => c.connectionType === 'oauth2-code')
    .filter((c) => (onlyId ? c.id === onlyId : c.enabled))

  console.log(`\n=== Channel token resolver verification ===`)
  console.log(`OAuth-linked channels found: ${channels.length}; testing: ${candidates.length}`)
  if (candidates.length === 0) {
    console.log('No enabled oauth2-code channels to test. Pass --id <integrationId> to target one.')
    await closePools()
    process.exit(0)
  }

  let pass = 0
  let fail = 0

  for (const c of candidates) {
    console.log(`\n--- ${c.provider}/${c.providerKey} <${c.email}> (integration ${c.id})`)
    const credentialId = c.credentialId!

    // Step 1: resolver serves a token directly (the new path).
    const resolved = await resolveConnectionForRuntime({
      connectionId: credentialId,
      organizationId: c.organizationId,
      userId: 'system',
      ensureFresh: true,
    })
    const conn = resolved.isOk()
      ? (resolved.value.organizationConnection ?? resolved.value.userConnection)
      : undefined
    const resolverToken = conn?.value || null
    console.log(
      `  resolveConnectionForRuntime: ${
        resolved.isOk() ? 'ok' : `ERR ${resolved.error.code}`
      } | type=${conn?.type ?? '-'} | token=${tokenHash(resolverToken)} | expiresAt=${
        conn?.expiresAt ?? '-'
      }`
    )

    // getChannelAccessToken (the seam the providers actually call).
    const accessToken = await getChannelAccessToken(c.id)
    const servedByResolver = !!resolverToken && accessToken === resolverToken
    console.log(
      `  getChannelAccessToken: token=${tokenHash(accessToken)} | servedByResolver=${servedByResolver}`
    )

    if (!accessToken) {
      console.log('  ✗ FAIL — no token served')
      fail++
      continue
    }
    if (!servedByResolver) {
      console.log('  ✗ FAIL — token did NOT come from the resolver (stored-token fallback hit)')
      fail++
      continue
    }
    console.log('  ✓ Step 1 — resolver serves the channel token')

    if (!doRefresh) {
      pass++
      continue
    }

    // Step 2: force-expire → confirm lazy refresh recovers it.
    const before = await readCred(credentialId, c.organizationId)
    if (!before.ok) {
      console.log(`  ✗ FAIL — could not read credential: ${before.error}`)
      fail++
      continue
    }
    if (!before.hasRefresh) {
      console.log("  ⚠ skip Step 2 — no refresh token stored (can't refresh)")
      pass++
      continue
    }

    const pastExpiry = new Date(Date.now() - 60 * 60 * 1000) // 1h ago
    await updateCredential(credentialId, c.organizationId, { expiresAt: pastExpiry })
    console.log(
      `  forced expiry -> ${pastExpiry.toISOString()} (was ${before.expiresAt?.toISOString() ?? '-'})`
    )

    // Trigger the lazy refresh through the same seam the providers use.
    await getChannelAccessToken(c.id)

    const after = await readCred(credentialId, c.organizationId)
    if (!after.ok) {
      console.log(`  ✗ FAIL — could not re-read credential: ${after.error}`)
      fail++
      continue
    }
    const recovered = !!after.expiresAt && after.expiresAt.getTime() > Date.now()
    const rotated = after.accessHash !== before.accessHash
    console.log(
      `  after refresh: expiresAt=${after.expiresAt?.toISOString() ?? '-'} | recovered=${recovered} | tokenRotated=${rotated} (${before.accessHash} -> ${after.accessHash})`
    )
    if (recovered) {
      console.log('  ✓ Step 2 — lazy refresh recovered the expired token')
      pass++
    } else {
      console.log('  ✗ FAIL — token did not recover after force-expire (check refresh grant)')
      fail++
    }
  }

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===\n`)
  await closePools()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('✗ Verification crashed:', err)
  process.exit(1)
})
