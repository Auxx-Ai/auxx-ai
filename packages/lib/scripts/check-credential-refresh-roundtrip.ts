// packages/lib/scripts/check-credential-refresh-roundtrip.ts
//
// Phase 5 checkpoint: mock OAuth token endpoint → McpServer (+oauth2-code def) →
// saveMcpConnection → resolveMcpConnectionForRuntime → force-expire → refreshCredentialTokens →
// assert new expiresAt, breaker reset, encryptedSecrets rotated (still v2:), metadata intact.
// The mcp branch shares the entire refresh code path with app-connections (only the owner key
// differs), so this exercises both. Cleans up after itself.
//
// Run from repo root under the worker runtime (the @auxx/lib import chain needs the `source`
// condition per project_tsx_scripts_filetype_esm):
//   npx dotenv -- node --conditions source --import tsx/esm \
//     packages/lib/scripts/check-credential-refresh-roundtrip.ts [organizationId]

import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'

const here = path.dirname(fileURLToPath(import.meta.url))
loadEnv({ path: path.resolve(here, '../../../.env') })

const { database, schema } = await import('@auxx/database')
const { eq } = await import('drizzle-orm')
const { getCredential, revealSecrets, updateCredential } = await import('@auxx/credentials/store')
const { encryptValue } = await import('@auxx/credentials/crypto')
const { saveMcpConnection, resolveMcpConnectionForRuntime } = await import('../src/ai/mcp')
const { refreshCredentialTokens } = await import('../src/workflows/oauth2-workflow')

const organizationId = process.argv[2] ?? 'abgwpa1l81reht2zmwrcihfu' // DemoOrg

const INITIAL_ACCESS = 'at-initial'
const INITIAL_REFRESH = 'rt-initial'
const ROTATED_ACCESS = 'at-rotated'
const ROTATED_REFRESH = 'rt-rotated'

/** Mock OAuth provider: returns a fresh token bundle on the refresh_token grant. */
async function startMockTokenServer() {
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => {
      body += c
    })
    req.on('end', () => {
      const params = new URLSearchParams(body)
      if (params.get('grant_type') !== 'refresh_token') return res.writeHead(400).end()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          access_token: ROTATED_ACCESS,
          refresh_token: ROTATED_REFRESH,
          expires_in: 3600,
          token_type: 'Bearer',
        })
      )
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  return {
    tokenUrl: `http://127.0.0.1:${port}/token`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  }
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message)
}

async function main() {
  const member = await database.query.OrganizationMember.findFirst({
    where: (m, { eq }) => eq(m.organizationId, organizationId),
    columns: { userId: true },
  })
  const createdById = member?.userId
  if (!createdById) throw new Error(`No member for org ${organizationId}`)

  const mock = await startMockTokenServer()
  console.log('✓ mock token endpoint at', mock.tokenUrl)

  const [server] = await database
    .insert(schema.McpServer)
    .values({
      organizationId,
      slug: `phase5-${Date.now()}`,
      name: 'Phase 5 Server',
      endpoint: 'http://127.0.0.1:0/mcp',
      createdById,
    })
    .returning({ id: schema.McpServer.id })
  if (!server) throw new Error('insert McpServer failed')

  await database.insert(schema.ConnectionDefinition).values({
    mcpServerId: server.id,
    major: 1,
    connectionType: 'oauth2-code',
    label: 'Phase 5 Connection',
    global: true,
    createdById,
    oauth2AccessTokenUrl: mock.tokenUrl,
    oauth2ClientId: encryptValue('client-id'),
    oauth2ClientSecret: encryptValue('client-secret'),
    oauth2TokenRequestAuthMethod: 'request-body',
  })

  try {
    // 1. Save.
    const saved = await saveMcpConnection({
      mcpServerId: server.id,
      serverName: 'Phase 5 Server',
      organizationId,
      createdById,
      connectionData: {
        accessToken: INITIAL_ACCESS,
        refreshToken: INITIAL_REFRESH,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        metadata: { account: 'phase5@example.com' },
      },
    })
    if (saved.isErr()) throw new Error(saved.error.message)
    const credentialId = saved.value
    console.log('✓ saved oauth2 mcp connection', credentialId)

    // 2. Resolve.
    const resolved = await resolveMcpConnectionForRuntime({
      mcpServerId: server.id,
      organizationId,
    })
    if (resolved.isErr()) throw new Error(resolved.error.message)
    assert(resolved.value.value === INITIAL_ACCESS, 'resolve returned wrong access token')
    assert(
      (resolved.value.metadata as { account?: string })?.account === 'phase5@example.com',
      'resolve lost metadata'
    )
    console.log('✓ resolved runtime connection (token + metadata intact)')

    // 3. Force-expire + simulate a prior failure so we can prove the breaker resets.
    await updateCredential(credentialId, organizationId, { expiresAt: new Date(Date.now() - 1000) })
    await database
      .update(schema.Credential)
      .set({ consecutiveRefreshFailures: 3 })
      .where(eq(schema.Credential.id, credentialId))
    console.log('✓ force-expired + seeded breaker = 3')

    // 4. Refresh.
    const result = await refreshCredentialTokens(credentialId, organizationId)
    assert(result.success, `refresh failed: ${result.error}`)
    assert(result.expiresAt instanceof Date, 'refresh returned no expiresAt')
    assert(result.expiresAt!.getTime() > Date.now(), 'new expiresAt is not in the future')
    console.log('✓ refresh succeeded, new expiresAt', result.expiresAt)

    // 5. Assertions on the persisted row.
    const after = await getCredential(credentialId, organizationId)
    if (after.isErr()) throw new Error(after.error.message)
    assert(after.value.consecutiveRefreshFailures === 0, 'breaker not reset')
    assert(
      (after.value.metadata as { account?: string }).account === 'phase5@example.com',
      'metadata not intact after refresh'
    )
    assert(after.value.expiresAt instanceof Date, 'expiresAt column not set')

    const revealed = await revealSecrets<{ accessToken?: string; refreshToken?: string }>(
      credentialId,
      organizationId
    )
    if (revealed.isErr()) throw new Error(revealed.error.message)
    assert(revealed.value.secrets.accessToken === ROTATED_ACCESS, 'access token not rotated')
    assert(revealed.value.secrets.refreshToken === ROTATED_REFRESH, 'refresh token not rotated')

    const [raw] = await database
      .select({ encryptedSecrets: schema.Credential.encryptedSecrets })
      .from(schema.Credential)
      .where(eq(schema.Credential.id, credentialId))
      .limit(1)
    assert(raw?.encryptedSecrets.startsWith('v2:'), 'encryptedSecrets is not v2-encrypted')
    console.log('✓ breaker reset, secrets rotated (v2:), metadata intact')

    console.log('\n✅ Phase 5 credential refresh roundtrip passed')
  } finally {
    await database.delete(schema.McpServer).where(eq(schema.McpServer.id, server.id))
    await mock.close()
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌', err)
    process.exit(1)
  })
