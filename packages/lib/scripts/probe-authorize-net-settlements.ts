// packages/lib/scripts/probe-authorize-net-settlements.ts
// Probe: answer every row of plans/apps/authorize-net/authorize-net-build-plan.md §3.5
// against the real reporting API. Read-only; nothing is written but the two reports.
//   AUTHORIZE_NET_CREDENTIAL_ID=… AUTHORIZE_NET_ORG_ID=… \
//     npx dotenv -- npx tsx packages/lib/scripts/probe-authorize-net-settlements.ts
// Keys are never echoed, never written to a report and never placed in argv.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { revealSecrets } from '@auxx/credentials/store'
import { database as db, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'

const CREDENTIAL_ID = process.env.AUTHORIZE_NET_CREDENTIAL_ID ?? ''
const ORG_ID = process.env.AUTHORIZE_NET_ORG_ID ?? ''
const FROM = process.env.AUTHORIZE_NET_FROM ?? '2026-01-01'
const TO = process.env.AUTHORIZE_NET_TO ?? new Date().toISOString().slice(0, 10)
const BATCHES = Number(process.env.AUTHORIZE_NET_BATCHES ?? 3)
const TODAY = new Date().toISOString().slice(0, 10)
const REPORT = process.env.AUTHORIZE_NET_REPORT ?? `plans/apps/authorize-net/probe-${TODAY}.md`
const OUT = process.env.AUTHORIZE_NET_OUT ?? 'plans/apps/authorize-net/probe-raw.json'

const ENDPOINTS = {
  live: 'https://api.authorize.net/xml/v1/request.api',
  test: 'https://apitest.authorize.net/xml/v1/request.api',
} as const

type Environment = keyof typeof ENDPOINTS

/** Fields the API returns unmasked; stripped recursively before anything is written. */
const PII_KEYS = ['billTo', 'shipTo', 'customer', 'firstName', 'lastName', 'email', 'phone']

interface Credentials {
  apiLoginId: string
  transactionKey: string
  environment: Environment
}

let API_LOGIN_ID = ''
let TRANSACTION_KEY = ''

/** Never let key material reach a console line or a report. */
function redact(text: string): string {
  let out = text
  for (const secret of [TRANSACTION_KEY, API_LOGIN_ID]) {
    if (secret) out = out.split(secret).join('«redacted»')
  }
  return out
}

function asEnvironment(value: string | undefined): Environment {
  return value?.trim().toLowerCase() === 'test' ? 'test' : 'live'
}

/**
 * Resolve the API Login ID + Transaction Key, preferring the org's stored credential.
 *
 * `api_login_id` and `environment` are plaintext on `metadata.connectionVariables` (an
 * account identifier and a host selector, not secrets); `transaction_key` comes back only
 * through {@link revealSecrets}.
 */
async function resolveCredentials(): Promise<Credentials> {
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
    // A MULTI-FIELD connection nests its variables under `secrets.fields[key]` (see
    // `merge-secret-fields.ts`); fall back to the flat shape for a single-secret one.
    const secrets = revealed.value.secrets as Record<string, unknown>
    const fields = (secrets.fields ?? secrets) as Record<string, string>

    const apiLoginId = vars.api_login_id || fields.api_login_id || ''
    const transactionKey = fields.transaction_key || ''
    if (!apiLoginId || !transactionKey) {
      throw new Error(
        `credential ${CREDENTIAL_ID} is missing fields — api_login_id:${Boolean(apiLoginId)} ` +
          `transaction_key:${Boolean(transactionKey)}. ` +
          `Secret keys present: ${Object.keys(fields).join(', ') || '(none)'}`
      )
    }
    const environment = asEnvironment(process.env.AUTHORIZE_NET_ENV ?? vars.environment)
    console.log(`Using stored credential ${CREDENTIAL_ID} (login ${apiLoginId}, ${environment})`)
    return { apiLoginId, transactionKey, environment }
  }

  const apiLoginId = process.env.AUTHORIZE_NET_API_LOGIN_ID ?? ''
  const transactionKey = process.env.AUTHORIZE_NET_TRANSACTION_KEY ?? ''
  if (!apiLoginId || !transactionKey) {
    throw new Error(
      'Missing credentials. Either set AUTHORIZE_NET_CREDENTIAL_ID + AUTHORIZE_NET_ORG_ID, ' +
        'or AUTHORIZE_NET_API_LOGIN_ID + AUTHORIZE_NET_TRANSACTION_KEY ' +
        '(plus AUTHORIZE_NET_ENV=live|test, default live).'
    )
  }
  return { apiLoginId, transactionKey, environment: asEnvironment(process.env.AUTHORIZE_NET_ENV) }
}

interface Call {
  request: string
  status: number
  ms: number
  resultCode: string | null
  messageCode: string | null
  messageText: string | null
  bom: boolean
  retryAfter: string | null
  note?: string
}

const calls: Call[] = []
let ENDPOINT: string = ENDPOINTS.live

/**
 * One reporting call. Every request is a POST of a single object keyed by its own name,
 * whose first member is `merchantAuthentication`.
 *
 * ⚠️ The response body is known to begin with a UTF-8 BOM that `JSON.parse` rejects
 * (§3.1) — stripping it here is the whole reason this function exists rather than `fetch`.
 */
async function post(
  request: string,
  body: Record<string, unknown>,
  note?: string
): Promise<{ json: Record<string, unknown> | null; call: Call }> {
  const payload = {
    [request]: {
      merchantAuthentication: { name: API_LOGIN_ID, transactionKey: TRANSACTION_KEY },
      ...body,
    },
  }
  const started = Date.now()
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    redirect: 'error',
    signal: AbortSignal.timeout(60_000),
  })
  const raw = await response.text()
  const bom = raw.charCodeAt(0) === 0xfeff
  const text = bom ? raw.slice(1) : raw

  let json: Record<string, unknown> | null = null
  try {
    json = JSON.parse(text) as Record<string, unknown>
  } catch {
    console.log(`  ${request} → NOT JSON: ${redact(text).slice(0, 200)}`)
  }
  const messages = (json?.messages ?? {}) as Record<string, unknown>
  const first = (Array.isArray(messages.message) ? messages.message[0] : messages.message) as
    | Record<string, string>
    | undefined

  const call: Call = {
    request,
    status: response.status,
    ms: Date.now() - started,
    resultCode: (messages.resultCode as string) ?? null,
    messageCode: first?.code ?? null,
    messageText: first?.text ? redact(first.text) : null,
    bom,
    retryAfter: response.headers.get('retry-after'),
    note,
  }
  calls.push(call)
  console.log(
    `  ${request} → ${response.status} ${call.resultCode ?? '(no resultCode)'} ` +
      `${call.messageCode ?? ''} ${call.messageText ?? ''}${bom ? '  [BOM]' : ''}`
  )
  return { json, call }
}

/** Recursively drop the keys the API returns unmasked. Arrays keep their shape. */
function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (PII_KEYS.includes(key)) continue
    out[key] = scrub(item)
  }
  return out
}

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  return value == null ? [] : [value as T]
}

function money(value: unknown): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

/** `'2026-01-01'` -> `'2026-01-01T00:00:00Z'`, the form every example uses. */
function stamp(day: string, endOfDay = false): string {
  return `${day}T${endOfDay ? '23:59:59' : '00:00:00'}Z`
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** Inclusive windows of at most `size` days, so the recalled 31-day cap is never hit. */
function windows(from: string, to: string, size = 31): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = []
  let cursor = from
  while (cursor <= to) {
    const end = addDays(cursor, size - 1)
    out.push({ from: cursor, to: end < to ? end : to })
    cursor = addDays(end, 1)
  }
  return out
}

interface Batch {
  batchId: string
  settlementTimeUTC?: string
  settlementState?: string
  statistics?: unknown
  [key: string]: unknown
}

/** Σ over accountTypes of `chargeAmount − refundAmount − returnedItemAmount` (§3.4 item 1). */
function headerAmount(batch: Batch): { total: number; perBrand: Record<string, number> } {
  const stats = asArray<Record<string, unknown>>(
    (batch.statistics as Record<string, unknown>)?.statistic ?? batch.statistics
  )
  const perBrand: Record<string, number> = {}
  let total = 0
  for (const stat of stats) {
    const net = money(stat.chargeAmount) - money(stat.refundAmount) - money(stat.returnedItemAmount)
    perBrand[String(stat.accountType ?? 'unknown')] = net
    total += net
  }
  return { total: Number(total.toFixed(2)), perBrand }
}

const findings: Array<[string, string]> = []
function answer(question: string, observed: string) {
  findings.push([question, observed])
  console.log(`  · ${question}: ${observed}`)
}

async function main() {
  const credentials = await resolveCredentials()
  API_LOGIN_ID = credentials.apiLoginId
  TRANSACTION_KEY = credentials.transactionKey
  ENDPOINT = ENDPOINTS[credentials.environment]

  const raw: Record<string, unknown> = {
    probedAt: new Date().toISOString(),
    environment: credentials.environment,
    endpoint: ENDPOINT,
    window: { from: FROM, to: TO },
  }
  console.log(`\nAuthorize.net probe — ${ENDPOINT}\nwindow ${FROM} → ${TO}\n`)

  // 1. Identity. §3.1: is there a stable id for dedup and `externalAccountId`?
  console.log('1. getMerchantDetailsRequest')
  const merchant = await post('getMerchantDetailsRequest', {})
  raw.merchantDetails = scrub(merchant.json)
  const merchantId = (merchant.json?.gatewayId as string) ?? null
  answer(
    'Do the reporting calls return data, or does the Transaction Details API toggle gate them?',
    `getMerchantDetails resultCode=${merchant.call.resultCode} ` +
      `${merchant.call.messageCode ?? ''} ${merchant.call.messageText ?? ''}`
  )
  answer(
    '`getMerchantDetails` — present, and a stable id?',
    merchantId
      ? `yes, gatewayId=${merchantId}`
      : `no gatewayId in the response (keys: ${Object.keys(merchant.json ?? {}).join(', ')}) — fall back to the API Login ID`
  )
  const currencies = asArray<string>(merchant.json?.currencies)
  answer(
    'Currency: on the batch, on the transaction, or only on getMerchantDetails?',
    currencies.length
      ? `getMerchantDetails.currencies = ${currencies.join(', ')}`
      : 'not on getMerchantDetails either — see the batch/transaction rows below'
  )

  // 2. Headers, windowed at ≤31 days.
  console.log('\n2. getSettledBatchListRequest (≤31-day windows)')
  const batches: Batch[] = []
  for (const window of windows(FROM, TO)) {
    const result = await post(
      'getSettledBatchListRequest',
      {
        includeStatistics: true,
        firstSettlementDate: stamp(window.from),
        lastSettlementDate: stamp(window.to, true),
      },
      `${window.from}→${window.to}`
    )
    batches.push(...asArray<Batch>(result.json?.batchList))
  }
  raw.batches = scrub(batches)
  answer('Batches in the window', `${batches.length} between ${FROM} and ${TO}`)

  // 3. Is the 31-day cap real? ONE deliberate 32-day request, recorded either way.
  console.log('\n3. getSettledBatchListRequest — one deliberate 32-day window')
  const wideTo = addDays(FROM, 31)
  const wide = await post(
    'getSettledBatchListRequest',
    {
      includeStatistics: true,
      firstSettlementDate: stamp(FROM),
      lastSettlementDate: stamp(wideTo, true),
    },
    `32 days: ${FROM}→${wideTo}`
  )
  answer(
    '31-day cap on getSettledBatchList?',
    wide.call.resultCode === 'Ok'
      ? `NO — a 32-day window (${FROM}→${wideTo}) returned Ok with ` +
          `${asArray(wide.json?.batchList).length} batches`
      : `YES — ${wide.call.messageCode} ${wide.call.messageText}`
  )
  answer(
    'BOM on the response body?',
    calls.some((call) => call.bom) ? 'YES — the client must strip it' : 'no BOM on any response'
  )

  const states = [...new Set(batches.map((batch) => String(batch.settlementState ?? '')))].sort()
  answer('settlementState values actually seen', states.join(', ') || '(none)')
  const errored = batches.filter((batch) => batch.settlementState !== 'settledSuccessfully')
  answer(
    'What does a non-successful batch look like, and does it carry money?',
    errored.length
      ? errored
          .slice(0, 3)
          .map((batch) => `${batch.batchId} ${batch.settlementState} $${headerAmount(batch).total}`)
          .join(' | ')
      : 'no non-successful batch in this window'
  )
  const multiBrand = batches.filter((batch) => Object.keys(headerAmount(batch).perBrand).length > 1)
  answer(
    'One batch = one bank deposit, or split per brand?',
    `${multiBrand.length}/${batches.length} batches carry more than one accountType — ` +
      'compare against the bank statement to settle it (§3.4 item 2)'
  )

  // §0's discrepancy: how much did Authorize.net actually carry Jan–May 2026?
  const byMonth = new Map<string, { count: number; total: number }>()
  for (const batch of batches) {
    const month = String(batch.settlementTimeUTC ?? '').slice(0, 7)
    if (!month) continue
    const bucket = byMonth.get(month) ?? { count: 0, total: 0 }
    bucket.count += 1
    bucket.total = Number((bucket.total + headerAmount(batch).total).toFixed(2))
    byMonth.set(month, bucket)
  }
  raw.byMonth = Object.fromEntries([...byMonth].sort())
  answer(
    'Jan–May 2026: how many batches, what total?',
    ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05']
      .map((month) => {
        const bucket = byMonth.get(month)
        return `${month}: ${bucket?.count ?? 0} batches, $${bucket?.total ?? 0}`
      })
      .join(' · ')
  )

  // 4. Members, by batchId. Paging base and the loop end.
  console.log(`\n4. getTransactionListRequest for the first ${BATCHES} batches`)
  const members: Record<string, Record<string, unknown>[]> = {}
  let pagingNote = 'no batch available to probe paging with'
  let listFields: string[] = []

  for (const batch of batches.slice(0, BATCHES)) {
    const page = async (offset: number, limit = 5) =>
      post(
        'getTransactionListRequest',
        {
          batchId: batch.batchId,
          paging: { limit, offset },
          sorting: { orderBy: 'submitTimeUTC', orderDescending: false },
        },
        `batch ${batch.batchId} offset ${offset}`
      )

    const first = await page(1)
    const second = await page(2)
    const zero = await page(0)
    if (pagingNote === 'no batch available to probe paging with') {
      const idOf = (result: Awaited<ReturnType<typeof page>>) =>
        String(asArray<Record<string, unknown>>(result.json?.transactions)[0]?.transId ?? '—')
      pagingNote =
        `offset 1 → first transId ${idOf(first)}; offset 2 → ${idOf(second)}; ` +
        `offset 0 → ${zero.call.resultCode} ${zero.call.messageCode ?? ''} ${idOf(zero)}`
    }

    // Full walk, so Σ member settleAmount can be compared to the header.
    const all: Record<string, unknown>[] = []
    let offset = 1
    let declared: number | null = null
    for (;;) {
      const result = await post(
        'getTransactionListRequest',
        { batchId: batch.batchId, paging: { limit: 1000, offset } },
        `batch ${batch.batchId} walk page ${offset}`
      )
      const rows = asArray<Record<string, unknown>>(result.json?.transactions)
      declared = declared ?? (Number(result.json?.totalNumInResultSet) || null)
      all.push(...rows)
      if (rows.length < 1000) break
      offset += 1
      if (offset > 20) break
    }
    members[batch.batchId] = all
    listFields = [...new Set([...listFields, ...all.flatMap((row) => Object.keys(row))])].sort()

    const summed = Number(
      all.reduce((acc, row) => acc + money(row.settleAmount ?? row.amount), 0).toFixed(2)
    )
    const header = headerAmount(batch)
    console.log(
      `  batch ${batch.batchId}: header $${header.total}  Σmembers $${summed}  ` +
        `(${all.length} rows, totalNumInResultSet=${declared})  ` +
        `${Math.abs(summed - header.total) < 0.005 ? 'AGREE' : '*** MISMATCH ***'}`
    )
    findings.push([
      `Batch ${batch.batchId} — header vs Σ members`,
      `header $${header.total} (${Object.entries(header.perBrand)
        .map(([brand, net]) => `${brand} ${net}`)
        .join(', ')}) · Σ members $${summed} over ${all.length} rows · ` +
        `totalNumInResultSet=${declared} · ` +
        `${Math.abs(summed - header.total) < 0.005 ? 'AGREE' : 'MISMATCH'}`,
    ])
  }
  raw.members = scrub(members)
  answer('paging.offset 1-based? totalNumInResultSet reliable?', pagingNote)
  answer('Per-transaction fields on the LIST', listFields.join(', ') || '(no member rows read)')
  answer(
    'Is settleAmount on the LIST, or only on getTransactionDetails?',
    listFields.includes('settleAmount')
      ? 'on the LIST — one call per batch is enough'
      : 'NOT on the list — a detail call per transaction would be 6,000+ for history'
  )

  // 5. One transaction's detail.
  const firstMember = Object.values(members)[0]?.[0]
  if (firstMember?.transId) {
    console.log('\n5. getTransactionDetailsRequest')
    const detail = await post('getTransactionDetailsRequest', { transId: firstMember.transId })
    const transaction = (detail.json?.transaction ?? {}) as Record<string, unknown>
    raw.transactionDetail = scrub(transaction)
    const order = (transaction.order ?? {}) as Record<string, unknown>
    answer(
      'order.invoiceNumber for a Shopify-originated transaction',
      order.invoiceNumber ? `"${order.invoiceNumber}"` : 'blank/absent — §6 A is the only join'
    )
    answer(
      'transaction detail',
      `transactionType=${transaction.transactionType} authCode=${transaction.authCode} ` +
        `settleAmount=${transaction.settleAmount} (list said ${firstMember.settleAmount ?? firstMember.amount}) ` +
        `currency=${transaction.currency ?? '(absent)'}`
    )
  } else {
    answer('order.invoiceNumber for a Shopify-originated transaction', 'no member to inspect')
  }

  // 6. The in-transit equivalent, and one batch's header on its own.
  console.log('\n6. getUnsettledTransactionListRequest + getBatchStatisticsRequest')
  const unsettled = await post('getUnsettledTransactionListRequest', {
    paging: { limit: 100, offset: 1 },
  })
  raw.unsettled = scrub(unsettled.json)
  answer(
    'Unsettled (in-transit) list',
    `${asArray(unsettled.json?.transactions).length} rows, ` +
      `totalNumInResultSet=${unsettled.json?.totalNumInResultSet ?? '(absent)'}`
  )

  const firstBatch = batches[0]
  if (firstBatch) {
    const stats = await post('getBatchStatisticsRequest', { batchId: firstBatch.batchId })
    raw.batchStatistics = scrub(stats.json)
  }

  answer(
    'Rate limits, and does 429 carry Retry-After?',
    calls.some((call) => call.status === 429)
      ? calls
          .filter((call) => call.status === 429)
          .map((call) => `${call.request} 429 retry-after=${call.retryAfter ?? '(none)'}`)
          .join(' | ')
      : `no 429 over ${calls.length} calls (slowest ${Math.max(...calls.map((c) => c.ms))}ms)`
  )

  raw.calls = calls
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(raw, null, 2))

  const markdown = [
    `<!-- ${REPORT} -->`,
    '',
    `# Authorize.net probe — ${TODAY}`,
    '',
    `Environment \`${credentials.environment}\` · endpoint \`${ENDPOINT}\` · window ${FROM} → ${TO}.`,
    `Answers plans/apps/authorize-net/authorize-net-build-plan.md §3.5. Raw payloads: \`${OUT}\`.`,
    '',
    '## §3.5',
    '',
    '| Question | Observed |',
    '| --- | --- |',
    ...findings.map(([question, observed]) => `| ${question} | ${observed} |`),
    '',
    '## Every call',
    '',
    '| Request | Note | HTTP | resultCode | code | text | BOM |',
    '| --- | --- | ---: | --- | --- | --- | --- |',
    ...calls.map(
      (call) =>
        `| \`${call.request}\` | ${call.note ?? ''} | ${call.status} | ${call.resultCode ?? ''} ` +
        `| ${call.messageCode ?? ''} | ${call.messageText ?? ''} | ${call.bom ? 'yes' : 'no'} |`
    ),
    '',
  ].join('\n')
  mkdirSync(dirname(REPORT), { recursive: true })
  writeFileSync(REPORT, markdown)

  console.log(`\nFindings → ${REPORT}`)
  console.log(`Raw payloads → ${OUT}`)
  console.log('⚠️  billTo/shipTo/customer/names/email/phone are stripped; review before sharing.')
}

main().catch((error) => {
  console.error(redact(error instanceof Error ? error.message : String(error)))
  process.exit(1)
})
