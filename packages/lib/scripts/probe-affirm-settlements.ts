// packages/lib/scripts/probe-affirm-settlements.ts
// Probe: what do Affirm's PUBLIC settlement endpoints actually return?
//
// Everything in plans/apps/affirm/portal-probe-2026-09-15.md came from the merchant
// portal's INTERNAL API and its CSV export. Those two disagree with each other — the
// portal JSON returns integer cents (374005) where the CSV returns decimal dollars
// (3740.05) for the same money — and neither is the surface the app consumes. This
// answers the open questions in the build plan §3.5 against the real thing.
//
// Read-only. Two GETs. No writes, no credential storage, nothing persisted but a
// findings report you choose the path of.
//
// Run (PREFERRED — reads the org's own connected Affirm credential):
//   AFFIRM_CREDENTIAL_ID=… AFFIRM_ORG_ID=… \
//     npx dotenv -- npx tsx packages/lib/scripts/probe-affirm-settlements.ts
//
// Run (fallback, keys supplied directly):
//   AFFIRM_MERCHANT_ID=… AFFIRM_PUBLIC_KEY=… AFFIRM_PRIVATE_KEY=… \
//     npx tsx packages/lib/scripts/probe-affirm-settlements.ts
//
// Either way the keys are never echoed, never written to the report, and never placed
// in argv (where they would reach `ps` and shell history). The credential route is
// preferred because the secrets go straight from `encryptedSecrets` into the request
// and are never typed, pasted or exported at all.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { revealSecrets } from '@auxx/credentials/store'
import { database as db, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'

const CREDENTIAL_ID = process.env.AFFIRM_CREDENTIAL_ID ?? ''
const ORG_ID = process.env.AFFIRM_ORG_ID ?? ''
const ORIGIN = process.env.AFFIRM_ORIGIN ?? 'https://api.affirm.com'
const AFTER = process.env.AFFIRM_AFTER ?? '2026-08-01'
const BEFORE = process.env.AFFIRM_BEFORE ?? ''
const LIMIT = Number(process.env.AFFIRM_LIMIT ?? 100)
const OUT = process.env.AFFIRM_OUT ?? 'plans/apps/affirm/probe-public-api-raw.json'

/**
 * Resolve merchant id + key pair, preferring the stored credential.
 *
 * `merchant_id` is plaintext on `metadata.connectionVariables` (it is an account
 * identifier, not a secret); the two keys live in `encryptedSecrets` and come back
 * only through {@link revealSecrets}.
 */
async function resolveCredentials(): Promise<{
  merchantId: string
  publicKey: string
  privateKey: string
}> {
  if (CREDENTIAL_ID && ORG_ID) {
    const [row] = await db
      .select({ metadata: schema.Credential.metadata })
      .from(schema.Credential)
      .where(eq(schema.Credential.id, CREDENTIAL_ID))
      .limit(1)
    const vars = ((row?.metadata as Record<string, unknown> | null)?.connectionVariables ??
      {}) as Record<string, string>

    const revealed = await revealSecrets<Record<string, string>>(CREDENTIAL_ID, ORG_ID)
    if (revealed.isErr()) throw new Error(`credential read failed: ${revealed.error.code}`)
    // `revealSecrets` returns `{ record, secrets }`, and a MULTI-FIELD connection nests its
    // variables one level further under `secrets.fields[key]` — see `merge-secret-fields.ts`:
    // "Multi-field secrets live under `secrets.fields[key]`". Fall back to the flat shape so
    // this also works against a single-secret connection.
    const secrets = revealed.value.secrets as Record<string, unknown>
    const fields = (secrets.fields ?? secrets) as Record<string, string>

    const merchantId = process.env.AFFIRM_MERCHANT_ID || vars.merchant_id || fields.merchant_id
    const publicKey = fields.public_key
    const privateKey = fields.private_key
    if (!merchantId || !publicKey || !privateKey) {
      throw new Error(
        `credential ${CREDENTIAL_ID} is missing fields — ` +
          `merchant_id:${Boolean(merchantId)} public_key:${Boolean(publicKey)} ` +
          `private_key:${Boolean(privateKey)}. Secret keys present: ${Object.keys(fields).join(', ') || '(none)'}`
      )
    }
    console.log(`Using stored credential ${CREDENTIAL_ID} (merchant ${merchantId})`)
    return { merchantId, publicKey, privateKey }
  }

  const merchantId = process.env.AFFIRM_MERCHANT_ID ?? ''
  const publicKey = process.env.AFFIRM_PUBLIC_KEY ?? ''
  const privateKey = process.env.AFFIRM_PRIVATE_KEY ?? ''
  if (!merchantId || !publicKey || !privateKey) {
    throw new Error(
      'Missing credentials. Either set AFFIRM_CREDENTIAL_ID + AFFIRM_ORG_ID, or ' +
        'AFFIRM_MERCHANT_ID + AFFIRM_PUBLIC_KEY + AFFIRM_PRIVATE_KEY.'
    )
  }
  return { merchantId, publicKey, privateKey }
}

let MERCHANT_ID = ''
let PUBLIC_KEY = ''
let PRIVATE_KEY = ''
let auth = ''

/** Strip anything that could carry key material out of a message before printing it. */
function redact(text: string): string {
  let out = text
  for (const secret of [PRIVATE_KEY, PUBLIC_KEY, auth]) {
    if (secret) out = out.split(secret).join('«redacted»')
  }
  return out
}

async function get(path: string, params: Record<string, string | number>) {
  const url = new URL(`${ORIGIN}/api/v1${path}`)
  for (const [k, v] of Object.entries(params)) {
    if (v !== '' && v !== undefined) url.searchParams.set(k, String(v))
  }
  url.searchParams.set('merchant_id', MERCHANT_ID)

  const response = await fetch(url, {
    headers: { Authorization: auth, Accept: 'application/json' },
    redirect: 'error', // never hand the credential to a provider-chosen host
    signal: AbortSignal.timeout(30_000),
  })
  const body = await response.text()
  // The path is printed WITHOUT the query string: merchant_id is an account identifier.
  console.log(`  ${path} → ${response.status} (${body.length} bytes)`)
  if (!response.ok) {
    console.log(`    body: ${redact(body).slice(0, 400)}`)
    return { status: response.status, json: null as unknown, headers: response.headers }
  }
  try {
    return { status: response.status, json: JSON.parse(body) as unknown, headers: response.headers }
  } catch {
    console.log(`    NOT JSON: ${redact(body).slice(0, 200)}`)
    return { status: response.status, json: null as unknown, headers: response.headers }
  }
}

/** Which key holds the array? The docs say `data`; the portal said `settlements`. */
function findRows(payload: unknown): { key: string; rows: Record<string, unknown>[] } | null {
  if (!payload || typeof payload !== 'object') return null
  const obj = payload as Record<string, unknown>
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) return { key, rows: value as Record<string, unknown>[] }
  }
  return null
}

/**
 * Cents or decimals? An integer with no fractional part is ambiguous on its own, so
 * decide on the whole sample: any non-integer anywhere proves decimals.
 */
function classifyUnits(rows: Record<string, unknown>[], fields: string[]) {
  let numeric = 0
  let nonInteger = 0
  let strings = 0
  const samples: Array<[string, unknown]> = []
  for (const row of rows) {
    for (const field of fields) {
      const value = row[field]
      if (value === undefined || value === null) continue
      if (samples.length < 6) samples.push([field, value])
      if (typeof value === 'string') strings++
      else if (typeof value === 'number') {
        numeric++
        if (!Number.isInteger(value)) nonInteger++
      }
    }
  }
  const verdict =
    strings > 0
      ? 'STRING amounts — translation must parse, not cast'
      : nonInteger > 0
        ? 'DECIMAL (major units) — flip AFFIRM_SETTLEMENT_MONEY_UNITS to "major"'
        : numeric > 0
          ? 'all integers — consistent with MINOR units (current default), but see note'
          : 'no amount fields found under these names'
  return { numeric, nonInteger, strings, samples, verdict }
}

async function main() {
  const resolved = await resolveCredentials()
  MERCHANT_ID = resolved.merchantId
  PUBLIC_KEY = resolved.publicKey
  PRIVATE_KEY = resolved.privateKey
  auth = `Basic ${Buffer.from(`${PUBLIC_KEY}:${PRIVATE_KEY}`).toString('base64')}`

  const report: Record<string, unknown> = {
    probedAt: new Date().toISOString(),
    origin: ORIGIN,
    window: { after: AFTER, before: BEFORE || '(open)' },
  }

  console.log(`\nAffirm public API probe — ${ORIGIN}/api/v1`)
  console.log(`window ${AFTER} → ${BEFORE || 'now'}\n`)

  console.log('1. GET /settlements/daily')
  const daily = await get('/settlements/daily', { after: AFTER, before: BEFORE, limit: LIMIT })
  const dailyRows = findRows(daily.json)

  console.log('\n2. GET /settlements/events')
  const events = await get('/settlements/events', { after: AFTER, before: BEFORE, limit: LIMIT })
  const eventRows = findRows(events.json)

  console.log('\n─── FINDINGS ───\n')

  // Q1/Q2: envelope shape and field vocabulary.
  for (const [label, res, found] of [
    ['daily', daily, dailyRows],
    ['events', events, eventRows],
  ] as const) {
    if (!found) {
      console.log(`${label}: no array found in the response. status=${res.status}`)
      continue
    }
    const envelopeKeys = Object.keys((res.json ?? {}) as object)
    const rowKeys = [...new Set(found.rows.flatMap((r) => Object.keys(r)))].sort()
    console.log(`${label}: array under "${found.key}", ${found.rows.length} rows`)
    console.log(`  envelope keys: ${envelopeKeys.join(', ')}`)
    console.log(`  row keys:      ${rowKeys.join(', ')}`)
    report[`${label}EnvelopeKeys`] = envelopeKeys
    report[`${label}RowKeys`] = rowKeys
    report[`${label}RowCount`] = found.rows.length
  }

  // Q1: units — the single most consequential answer.
  if (dailyRows) {
    const u = classifyUnits(dailyRows.rows, [
      'total_settled',
      'total_sales',
      'total_fees',
      'total_refunds',
      'sales',
      'fees',
      'refunds',
    ])
    console.log(`\nUNITS (daily): ${u.verdict}`)
    console.log(`  samples: ${u.samples.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('  ')}`)
    report.dailyUnits = u
  }

  // Q3: do events carry a currency? The contract requires one per entry.
  if (eventRows) {
    const withCurrency = eventRows.rows.filter((r) => r.currency != null).length
    console.log(
      `\nCURRENCY on events: ${withCurrency}/${eventRows.rows.length} rows carry it` +
        (withCurrency === 0 ? '  ← the USD fallback stays load-bearing' : '')
    )
    const types = [...new Set(eventRows.rows.map((r) => String(r.event_type)))].sort()
    console.log(`EVENT TYPES seen: ${types.join(', ') || '(none)'}`)
    console.log('  (docs say loan_capture; the CSV export said loan_captured)')
    report.eventCurrencyCoverage = `${withCurrency}/${eventRows.rows.length}`
    report.eventTypes = types

    // Q4: refund sign — never observed; every probed refund was 0.00.
    const refunds = eventRows.rows.filter((r) => Number(r.refunds ?? 0) !== 0)
    console.log(
      `REFUND SIGN: ${refunds.length} non-zero refund rows` +
        (refunds.length
          ? ` → ${refunds
              .slice(0, 3)
              .map((r) => `refunds=${r.refunds}, fees=${r.fees}`)
              .join(' | ')}`
          : '  ← still unproven')
    )
    report.refundSamples = refunds.slice(0, 5)
  }

  // Q5: does the sum of a deposit's events equal the summary? Rule 3 says the deposit
  // is TRANSCRIBED, never summed — so a mismatch is a finding, not a thing to paper over.
  if (dailyRows && eventRows) {
    console.log('\nMEMBERSHIP SUM CHECK (per deposit_id):')
    let checked = 0
    for (const summary of dailyRows.rows) {
      const depositId = String(summary.deposit_id ?? '')
      if (!depositId) continue
      const members = eventRows.rows.filter((r) => String(r.deposit_id ?? '') === depositId)
      if (!members.length) continue
      const summed = members.reduce((acc, r) => acc + Number(r.total_settled ?? 0), 0)
      const header = Number(summary.total_settled ?? 0)
      const agrees = Math.abs(summed - header) < 1e-6
      console.log(
        `  ${depositId}  header=${header}  Σevents=${summed.toFixed(2)}  ` +
          `(${members.length} events)  ${agrees ? 'AGREE' : '*** MISMATCH ***'}`
      )
      checked++
    }
    if (!checked) console.log('  no deposit had matching events in this window — widen it')
    report.membershipChecked = checked
  }

  // Q6: can one deposit_id span two dates? Decides payout identity.
  if (eventRows) {
    const dates = new Map<string, Set<string>>()
    for (const row of eventRows.rows) {
      const id = String(row.deposit_id ?? '')
      if (!id) continue
      if (!dates.has(id)) dates.set(id, new Set())
      dates.get(id)!.add(String(row.date ?? ''))
    }
    const spanning = [...dates.entries()].filter(([, d]) => d.size > 1)
    console.log(
      `\nDEPOSIT SPANNING DATES: ${spanning.length} of ${dates.size} deposit_ids span >1 event date` +
        (spanning.length ? '  ← payout identity may need <date>:<deposit_id>' : '')
    )
    report.depositsSpanningDates = spanning.map(([id, d]) => [id, [...d]])
  }

  // Q7: unassigned activity — the whole reason the balance_transaction stream exists.
  if (eventRows) {
    const orphans = eventRows.rows.filter((r) => !r.deposit_id).length
    console.log(`UNASSIGNED EVENTS (no deposit_id): ${orphans}/${eventRows.rows.length}`)
    report.unassignedEvents = orphans
  }

  report.rawDaily = daily.json
  report.rawEvents = events.json
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(report, null, 2))
  console.log(`\nRaw payloads + findings → ${OUT}`)
  console.log('⚠️  Review that file for customer PII before committing or sharing it.')
}

main().catch((error) => {
  console.error(redact(error instanceof Error ? error.message : String(error)))
  process.exit(1)
})
