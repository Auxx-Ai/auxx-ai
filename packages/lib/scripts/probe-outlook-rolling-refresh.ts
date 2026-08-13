// packages/lib/scripts/probe-outlook-rolling-refresh.ts
// §7 verification (channels-onto-connections): confirm a raw Microsoft `refresh_token` POST
// returns a ROLLING refresh token — i.e. the generic refresh path (which would replace MSAL)
// gets a fresh refresh_token back and persists it. If yes, `@azure/msal-node` can be dropped
// and Outlook expiry-refresh can route through getChannelAccessToken / refreshCredentialTokens.
//
// Exercises the real generic path (oauth2-token-grants.refreshCredentialTokens) against the live
// Outlook credential, comparing the stored refresh/access tokens before and after. Non-destructive:
// the path persists the rotated tokens, so the integration stays healthy.
//
// Run: npx dotenv -- node --conditions source --import tsx/esm \
//   packages/lib/scripts/probe-outlook-rolling-refresh.ts <integrationId>

import { createHash } from 'node:crypto'
import { refreshCredentialTokens } from '@auxx/credentials/connections'
import { revealSecrets } from '@auxx/credentials/store'
import { closePools, database as db, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'

/* eslint-disable no-console */

const integrationId = process.argv[2] ?? 'd60yqovf10e7p5n6kntc82gp'

function h(t: string | null | undefined): string {
  return t ? createHash('sha256').update(t).digest('hex').slice(0, 12) : '<none>'
}

const [integ] = await db
  .select({
    credentialId: schema.Integration.credentialId,
    organizationId: schema.Integration.organizationId,
    email: schema.Integration.email,
  })
  .from(schema.Integration)
  .where(eq(schema.Integration.id, integrationId))
  .limit(1)

if (!integ?.credentialId) {
  console.error('no credential on integration', integrationId)
  process.exit(1)
}

type S = { accessToken?: string; refreshToken?: string }
const before = await revealSecrets<S>(integ.credentialId, integ.organizationId)
if (before.isErr()) {
  console.error('reveal failed:', before.error.message)
  process.exit(1)
}
const beforeAccess = h(before.value.secrets.accessToken)
const beforeRefresh = h(before.value.secrets.refreshToken)

console.log(`\n=== §7 Outlook rolling-refresh probe — <${integ.email}> ===`)
console.log('before: access =', beforeAccess, '| refresh =', beforeRefresh)

const result = await refreshCredentialTokens(integ.credentialId, integ.organizationId)
console.log('refreshCredentialTokens:', JSON.stringify(result))

const after = await revealSecrets<S>(integ.credentialId, integ.organizationId)
if (after.isErr()) {
  console.error('reveal-after failed:', after.error.message)
  process.exit(1)
}
const afterAccess = h(after.value.secrets.accessToken)
const afterRefresh = h(after.value.secrets.refreshToken)

console.log('after:  access =', afterAccess, '| refresh =', afterRefresh)

const accessRotated = afterAccess !== beforeAccess
const refreshRotated = afterRefresh !== beforeRefresh
console.log('\nresults:')
console.log('  success            =', result.success)
console.log('  access token rotated =', accessRotated)
console.log('  refresh token ROLLING =', refreshRotated, '<-- the §7 question')
console.log('  new expiresAt       =', result.expiresAt?.toISOString?.() ?? result.expiresAt)

if (result.success && refreshRotated) {
  console.log(
    '\n✅ Microsoft returned a rolling refresh_token and the generic path persisted it — MSAL can be dropped.'
  )
} else if (result.success && !refreshRotated) {
  console.log(
    '\n⚠️ Refresh succeeded but the stored refresh token did NOT change — Microsoft did not roll it (or only on some grants). Investigate before dropping MSAL.'
  )
} else {
  console.log('\n❌ Refresh failed — see error above.')
}

await closePools()
process.exit(result.success ? 0 : 1)
