// scripts/spike-shopify-seat-usage.ts
//
// Throwaway spike for the Shopify per-seat usage drip (plans/billing/v2/14 §7 step 1).
// Exercises the App Events write path end-to-end against the dev shop and prints what it
// did so you can cross-check the Dev Dashboard → App → Billing event logs (the only
// authoritative record — the API returns 202 for everything, §3.1).
//
// Run with:
//   pnpm dotenv -- npx tsx scripts/spike-shopify-seat-usage.ts --token-only
//   pnpm dotenv -- npx tsx scripts/spike-shopify-seat-usage.ts            # full drip, today
//   pnpm dotenv -- npx tsx scripts/spike-shopify-seat-usage.ts --date 2026-06-01
//   pnpm dotenv -- npx tsx scripts/spike-shopify-seat-usage.ts --org <orgId>
//
// Layers (each builds on the previous):
//   --token-only   Layer 1: mint the client-credentials token from SHOPIFY_API_KEY/SECRET.
//                  Needs NO Partner Dashboard setup. Proves the grant + credentials work.
//   (default)      Layers 2+3: reportOrgSeatDay() → resolves+caches the Shop GID via Admin
//                  API, then POSTs one idempotent seat_day event. Re-runnable (idempotent on
//                  (org, day)). The event only actually BILLS once the seat_day meter exists
//                  on a plan the shop is subscribed to — otherwise it 202s and drops.

import { reportOrgSeatDay } from '@auxx/billing'
import { closePools, database as db } from '@auxx/database'

// Default to the dev Shopify-billed org (auxxai.myshopify.com).
const DEFAULT_ORG = 'jakjbc20mnd5dul8wzgnhepa'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`)

async function mintTokenRaw(): Promise<void> {
  const clientId = process.env.SHOPIFY_API_KEY
  const clientSecret = process.env.SHOPIFY_API_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('SHOPIFY_API_KEY and SHOPIFY_API_SECRET must be set in the loaded env')
  }
  console.log('Layer 1 — minting client-credentials token …')
  const res = await fetch('https://api.shopify.com/auth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
  })
  const text = await res.text()
  if (!res.ok) {
    console.error(`✗ token mint failed (${res.status}): ${text}`)
    process.exitCode = 1
    return
  }
  const json = JSON.parse(text) as { access_token: string; token_type?: string }
  // Response is { access_token, token_type } only — expiry lives in the JWT `exp` claim.
  const parts = json.access_token.split('.')
  const payload =
    parts.length === 3
      ? (JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as {
          exp?: number
          iat?: number
          scopes?: unknown
        })
      : {}
  console.log('✓ token minted', {
    tokenPreview: `${json.access_token.slice(0, 12)}…`,
    token_type: json.token_type,
    ttl_min: payload.exp && payload.iat ? Math.round((payload.exp - payload.iat) / 60) : 'n/a',
    expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : 'n/a',
  })
}

async function runDrip(orgId: string, date: Date): Promise<void> {
  const before = await db.query.PlanSubscription.findFirst({
    where: (s, { eq: e }) => e(s.organizationId, orgId),
    columns: {
      seats: true,
      status: true,
      billingProvider: true,
      shopifyShopDomain: true,
      shopifyShopGid: true,
    },
  })
  console.log('Org row before drip:', before)

  console.log(`\nLayers 2+3 — reportOrgSeatDay(${orgId}, ${date.toISOString().slice(0, 10)}) …`)
  const report = await reportOrgSeatDay(db, { organizationId: orgId, date })
  console.log('→ SeatDayReport:', report)

  const after = await db.query.PlanSubscription.findFirst({
    where: (s, { eq: e }) => e(s.organizationId, orgId),
    columns: { shopifyShopGid: true },
  })
  console.log('Shop GID after drip (cached lazily on first run):', after?.shopifyShopGid ?? null)

  console.log(
    '\nNext: open the Dev Dashboard → your app → Billing → events and confirm a seat_day\n' +
      `event for ${before?.shopifyShopDomain} with value=${report.seats} on ` +
      `${report.date}. If status was "accepted" but no event shows, the seat_day meter is\n` +
      "not attached to the shop's plan yet (§7 prerequisite)."
  )
}

async function main() {
  if (hasFlag('token-only')) {
    await mintTokenRaw()
    return
  }

  const orgId = arg('org') ?? DEFAULT_ORG
  const dateArg = arg('date')
  const date = dateArg
    ? new Date(`${dateArg}T00:00:00.000Z`)
    : new Date(
        Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())
      )

  // Token mint first (clear failure surface), then the full drip.
  await mintTokenRaw()
  console.log('')
  await runDrip(orgId, date)
}

main()
  .catch((err) => {
    console.error('spike failed:', err)
    process.exitCode = 1
  })
  .finally(() => closePools())
