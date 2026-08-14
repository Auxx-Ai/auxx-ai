// packages/lib/scripts/probe-outlook-subscription.ts
// Phase 0 gate (plans/outlook/webhook-push-migration.md §2.6): empirically prove whether our
// current Outlook OAuth scopes (Mail.ReadWrite + Mail.Send + User.Read, NO Mail.Read) can create a
// Microsoft Graph `message` subscription. Graph's docs warn subscriptions "don't support write
// access permissions when only read access permissions are needed" — this script is the real test
// against a live mailbox, not a doc read. No DB writes. Deletes the subscription it creates on 201.
//
// Run: npx dotenv -- npx tsx packages/lib/scripts/probe-outlook-subscription.ts [--integration <id>] [--url <notificationUrl>]

import { randomBytes } from 'node:crypto'
import { WEBAPP_URL } from '@auxx/config/server'
import { closePools, database as db, schema } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'
import { getChannelAccessToken } from '../src/providers/channel-token-accessor'

/* eslint-disable no-console */

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
const FETCH_TIMEOUT_MS = 30_000
const SUBSCRIPTION_TTL_MS = (6 * 24 + 20) * 60 * 60 * 1000 // 6d20h, per plan §2.1

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 ? process.argv[i + 1] : undefined
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// 1. Resolve the target integration and notification URL.
const integrationIdArg = argValue('--integration')
const urlArg = argValue('--url')

const [integ] = integrationIdArg
  ? await db
      .select({ id: schema.Integration.id, email: schema.Integration.email })
      .from(schema.Integration)
      .where(eq(schema.Integration.id, integrationIdArg))
      .limit(1)
  : await db
      .select({ id: schema.Integration.id, email: schema.Integration.email })
      .from(schema.Integration)
      .where(
        and(
          eq(schema.Integration.provider, 'outlook'),
          eq(schema.Integration.enabled, true),
          isNull(schema.Integration.deletedAt)
        )
      )
      .limit(1)

if (!integ) {
  console.error('No matching Outlook integration found (pass --integration <id> to target one).')
  process.exit(1)
}

// Same NGROK_URL-first convention as the runtime arming path (webhook-callback-base.ts) —
// Graph rejects http:// notification URLs, so localhost can never pass validation.
const notificationUrl = urlArg ?? `${process.env.NGROK_URL || WEBAPP_URL}/api/outlook/webhook`

console.log('\n=== Phase 0 — Outlook subscription scope probe ===')
console.log('integration :', integ.id, `(${integ.email ?? 'no email on row'})`)
console.log('notification url:', notificationUrl)

if (/localhost|127\.0\.0\.1/i.test(notificationUrl)) {
  console.warn(
    '\n⚠️  WARNING: notification URL looks local. Graph must be able to reach it over the public ' +
      'internet to complete the validation handshake (§2.4) — this call will fail as an endpoint ' +
      'validation failure, not a scope failure. Use a tunnel (e.g. `ngrok http 3000`) and pass ' +
      '--url <tunnel>/api/outlook/webhook.\n'
  )
}

// 2. Resolve a fresh access token through the same seam production code uses.
const accessToken = await getChannelAccessToken(integ.id)
if (!accessToken) {
  console.error('Could not resolve an access token for this integration — is it connected?')
  process.exit(1)
}

// 3. Raw POST to Graph — deliberately bypasses OutlookProvider so this probes exactly what the
// plan's §2.6 question asks: do our stored scopes, as-is, let a subscription be created at all.
const clientState = randomBytes(16).toString('hex')
const expirationDateTime = new Date(Date.now() + SUBSCRIPTION_TTL_MS).toISOString()
const body = {
  changeType: 'created,updated',
  notificationUrl,
  lifecycleNotificationUrl: `${notificationUrl}/lifecycle`,
  resource: "/me/mailFolders('inbox')/messages",
  expirationDateTime,
  clientState,
}

console.log('\nPOST /subscriptions ...', JSON.stringify(body, null, 2))

const res = await fetchWithTimeout(`${GRAPH_BASE}/subscriptions`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})
const responseText = await res.text()
let parsed: any
try {
  parsed = JSON.parse(responseText)
} catch {
  parsed = responseText
}

// 4. Outcome report.
if (res.status === 201) {
  console.log('\n✅ SUCCESS (201) — scopes are sufficient. Plan proceeds unchanged (Phase 1+).')
  console.log('  subscription id   :', parsed.id)
  console.log('  expirationDateTime:', parsed.expirationDateTime)

  const del = await fetchWithTimeout(`${GRAPH_BASE}/subscriptions/${parsed.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  console.log(
    del.status === 204
      ? '  cleanup: deleted subscription OK (204)'
      : `  cleanup: DELETE returned ${del.status} — subscription may need manual cleanup (id above)`
  )
  await closePools()
  process.exit(0)
}

const bodyStr = typeof parsed === 'string' ? parsed : JSON.stringify(parsed)
const looksLikeScopeFailure =
  res.status === 403 || /ExtensionError|AccessDenied|insufficient/i.test(bodyStr)
const looksLikeValidationFailure =
  res.status === 400 && /ValidationError|notification url/i.test(bodyStr)

if (looksLikeScopeFailure) {
  console.error('\n❌ SCOPE FAILURE —', res.status)
  console.error(bodyStr)
  console.error(
    '\nRemediation (plan §2.6): add https://graph.microsoft.com/Mail.Read to ' +
      'outlook-oauth2.credentials.ts and the seeded ConnectionDefinition.oauth2Scopes row (needs a ' +
      'data migration), then plan the re-consent rollout for every connected Outlook mailbox. ' +
      'This materially changes the plan — stop and re-scope before continuing.'
  )
} else if (looksLikeValidationFailure) {
  console.error('\n⚠️  ENDPOINT VALIDATION FAILURE —', res.status)
  console.error(bodyStr)
  console.error(
    '\nGraph could not reach/validate the notification URL within 10s (§2.4). Scopes may still be ' +
      'fine — retry with a public tunnel URL via --url.'
  )
} else {
  console.error('\n❓ UNEXPECTED RESPONSE —', res.status)
  console.error(bodyStr)
}

await closePools()
process.exit(1)
