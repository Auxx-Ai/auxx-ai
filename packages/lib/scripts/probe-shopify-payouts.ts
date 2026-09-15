// packages/lib/scripts/probe-shopify-payouts.ts
// Read-only evidence for accounting brief 30. No credential refresh or database writes.
// Prints allowlisted financial fields, IDs, shapes and counts, never raw responses.
// Run from repo root: pnpm exec dotenv -- node --import tsx packages/lib/scripts/probe-shopify-payouts.ts
// Optional: SHOP, SHOPIFY_PROBE_CREDENTIAL_ID, SHOPIFY_PROBE_TOKEN,
// SHOPIFY_PROBE_API_VERSION, PAYOUT_IDS (comma-separated), PAYOUT_SAMPLE_SIZE,
// PAYOUT_PAGE_SIZE, PAYOUT_MAX_PAGES. Use --help without loading credentials.

type Row = Record<string, unknown>

function object(value: unknown): Row {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {}
}

function report(label: string, value: unknown) {
  console.log(JSON.stringify({ label, value }, (_, v) => (typeof v === 'bigint' ? String(v) : v)))
}

function pick(row: Row, keys: string[]): Row {
  return Object.fromEntries(keys.filter((key) => key in row).map((key) => [key, row[key]]))
}

function countSetting(key: string, fallback: number, max: number): number {
  const value = Number(process.env[key] ?? fallback)
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`Invalid ${key}`)
  return value
}

function shopDomain(value: unknown): string {
  if (typeof value !== 'string' || !value) return ''
  const domain = value.includes('.') ? value.toLowerCase() : `${value.toLowerCase()}.myshopify.com`
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain) ? domain : ''
}

async function resolveToken(shop: string): Promise<string> {
  if (process.env.SHOPIFY_PROBE_TOKEN) return process.env.SHOPIFY_PROBE_TOKEN
  const [{ database: db, schema }, { and, eq, ilike, or }, { decryptSecrets }] = await Promise.all([
    import('@auxx/database'),
    import('drizzle-orm'),
    import('@auxx/credentials/crypto'),
  ])
  // Restrict discovery to Shopify credentials, and decrypt only the selected store.
  const rows = await db
    .select({ credential: schema.Credential })
    .from(schema.Credential)
    .leftJoin(schema.App, eq(schema.App.id, schema.Credential.appId))
    .where(
      and(
        or(eq(schema.App.slug, 'shopify'), ilike(schema.Credential.type, 'shopify%')),
        process.env.SHOPIFY_PROBE_CREDENTIAL_ID
          ? eq(schema.Credential.id, process.env.SHOPIFY_PROBE_CREDENTIAL_ID)
          : undefined
      )
    )
  const candidates = rows
    .map(({ credential }) => credential)
    .filter((row) => {
      const md = object(row.metadata)
      return shopDomain(md.shopDomain ?? object(md.connectionVariables).shop) === shop
    })
  report(
    'credentialCandidates',
    candidates.map((row) => ({
      id: row.id,
      organizationId: row.organizationId,
      isDefault: row.isDefault,
      expiresAt: row.expiresAt,
      requiresReauth: row.requiresReauth,
    }))
  )
  if (candidates.length !== 1) {
    throw new Error(
      'Expected one Shopify credential for SHOP; select SHOPIFY_PROBE_CREDENTIAL_ID or provide SHOPIFY_PROBE_TOKEN'
    )
  }
  const candidate = candidates[0]!
  const secrets = object(decryptSecrets(candidate.encryptedSecrets))
  const token =
    secrets.accessToken ||
    secrets.access_token ||
    secrets.token ||
    secrets.secret ||
    object(secrets.fields).api_key
  if (typeof token !== 'string' || !token)
    throw new Error('Selected credential has no Shopify token')
  return token
}

const PAYOUT_KEYS = ['id', 'status', 'date', 'currency', 'amount']
const ITEM_KEYS = [
  'id',
  'type',
  'test',
  'payout_id',
  'payout_status',
  'currency',
  'amount',
  'fee',
  'net',
  'source_id',
  'source_type',
  'source_order_id',
  'source_order_transaction_id',
  'processed_at',
]

function itemSample(row: Row): Row {
  const adjustments = row.adjustment_order_transactions
  return {
    ...pick(row, ITEM_KEYS),
    adjustment_reason_present: row.adjustment_reason != null,
    adjustment_reason:
      typeof row.adjustment_reason === 'string' && /^[a-zA-Z0-9_]+$/.test(row.adjustment_reason)
        ? row.adjustment_reason
        : null,
    adjustment_order_transactions: Array.isArray(adjustments)
      ? adjustments.map((value) => {
          const adjustment = object(value)
          return {
            fields: Object.keys(adjustment).sort(),
            ...pick(adjustment, ['id', 'amount', 'fee', 'fees', 'net']),
            order: pick(object(adjustment.order), ['id']),
          }
        })
      : adjustments,
  }
}

function histogram(rows: Row[], key: string): Row {
  const result: Record<string, number> = Object.create(null)
  for (const row of rows) {
    const value = String(row[key] ?? '(null/absent)')
    result[value] = (result[value] ?? 0) + 1
  }
  return result
}

// Probe arithmetic uses exact decimal strings at the observed scale. It deliberately
// does not assign a currency exponent or reuse the app's hard-coded x100 conversion.
function exactAmount(value: unknown, scale: number): bigint {
  if (typeof value !== 'string' || !/^-?\d+(\.\d+)?$/.test(value)) {
    throw new Error('Missing or malformed monetary string')
  }
  const negative = value.startsWith('-')
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.')
  if (fraction.length > scale) throw new Error('Amount exceeds observed decimal scale')
  return BigInt(`${whole}${fraction.padEnd(scale, '0')}`) * (negative ? -1n : 1n)
}

function reconcile(header: Row, rows: Row[], complete: boolean) {
  try {
    if (rows.some((row) => row.currency !== header.currency)) throw new Error('Currency mismatch')
    const amounts = [header.amount, ...rows.flatMap((row) => [row.amount, row.fee, row.net])]
    const scale = Math.max(
      0,
      ...amounts.map((v) => (typeof v === 'string' ? (v.split('.')[1]?.length ?? 0) : 0))
    )
    const sum = (items: Row[], key: string) =>
      items.reduce((total, row) => total + exactAmount(row[key], scale), 0n)
    const deposit = exactAmount(header.amount, scale)
    const included = rows.filter((row) => row.type !== 'payout')
    const net = sum(included, 'net')
    return {
      complete,
      currency: header.currency,
      decimalScale: scale,
      reportedAmountScaled: deposit,
      allRowsNetScaled: sum(rows, 'net'),
      excludingPayoutTransferNetScaled: net,
      excludedTransferRows: rows.length - included.length,
      differenceScaled: net - deposit,
      rowArithmeticMismatches: rows.filter(
        (row) =>
          exactAmount(row.amount, scale) - exactAmount(row.fee, scale) !==
          exactAmount(row.net, scale)
      ).length,
      conclusion: complete
        ? net === deposit
          ? 'sample agrees excluding payout transfers'
          : 'sample differs excluding payout transfers'
        : 'incomplete; no settlement conclusion',
    }
  } catch (error) {
    return {
      complete,
      conclusion: 'cannot compare',
      reason: error instanceof Error ? error.message : 'Invalid amounts',
    }
  }
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log(
      'Read-only Shopify payout probe. Default SHOP=storage-system.myshopify.com, API=2026-07, 3 sampled payouts, 250 items/page, at most 10 pages/payout. Optional env: SHOP, SHOPIFY_PROBE_CREDENTIAL_ID, SHOPIFY_PROBE_TOKEN, SHOPIFY_PROBE_API_VERSION, PAYOUT_IDS, PAYOUT_SAMPLE_SIZE (1-20), PAYOUT_PAGE_SIZE (1-250), PAYOUT_MAX_PAGES (1-100). Page caps are reported as incomplete. Tokens and raw payloads are never printed. No token refresh is attempted.'
    )
    return
  }
  const shop = shopDomain(process.env.SHOP ?? 'storage-system.myshopify.com')
  if (!shop) throw new Error('SHOP must be a Shopify subdomain or myshopify.com hostname')
  const api = process.env.SHOPIFY_PROBE_API_VERSION ?? '2026-07'
  if (!/^\d{4}-(01|04|07|10)$/.test(api)) throw new Error('Invalid SHOPIFY_PROBE_API_VERSION')
  const sampleSize = countSetting('PAYOUT_SAMPLE_SIZE', 3, 20)
  const pageSize = countSetting('PAYOUT_PAGE_SIZE', 250, 250)
  const maxPages = countSetting('PAYOUT_MAX_PAGES', 10, 100)
  const ids = process.env.PAYOUT_IDS?.split(',').map((id) => id.trim())
  if (ids && (ids.length > 20 || ids.some((id) => !/^\d+$/.test(id))))
    throw new Error('Invalid PAYOUT_IDS')
  const token = await resolveToken(shop)
  const origin = `https://${shop}`
  const base = `/admin/api/${api}`
  report('run', {
    at: new Date().toISOString(),
    shop,
    requestedApiVersion: api,
    sampleSize,
    pageSize,
    maxPages,
  })

  async function request(
    path: string,
    query?: string
  ): Promise<{ body: Row; next: string | null }> {
    const url = new URL(path, origin)
    if (url.origin !== origin || !url.pathname.startsWith('/admin/'))
      throw new Error('Refused off-store URL')
    const response = await fetch(url, {
      method: query ? 'POST' : 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(25_000),
      headers: {
        'X-Shopify-Access-Token': token,
        ...(query ? { 'Content-Type': 'application/json' } : {}),
      },
      body: query ? JSON.stringify({ query }) : undefined,
    })
    report('http', {
      path: url.pathname,
      status: response.status,
      servedApiVersion: response.headers.get('x-shopify-api-version'),
      requestId: response.headers.get('x-request-id'),
      retryAfter: response.headers.get('retry-after'),
    })
    if (!response.ok) throw new Error(`Shopify HTTP ${response.status} at ${url.pathname}`)
    const body = object(await response.json())
    if (Array.isArray(body.errors)) {
      report(
        'graphqlErrors',
        body.errors.map((error) => ({
          ...pick(object(error), ['message', 'path']),
          code: object(object(error).extensions).code,
        }))
      )
      throw new Error('GraphQL returned errors; optional inspection unavailable')
    }
    const next = response.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null
    return { body, next }
  }

  function collection(body: Row, key: string): Row[] {
    const rows = body[key]
    if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== 'object'))
      throw new Error(`Missing ${key} array`)
    // Refuse lossy JSON numeric IDs instead of stringifying a rounded identifier.
    for (const row of rows) {
      for (const [key, value] of Object.entries(object(row))) {
        if (
          (key === 'id' || key.endsWith('_id')) &&
          typeof value === 'number' &&
          !Number.isSafeInteger(value)
        )
          throw new Error('Unsafe numeric provider ID')
      }
    }
    return rows.map(object)
  }

  const scopes = await request('/admin/oauth/access_scopes.json')
  const grantedScopes = collection(scopes.body, 'access_scopes').map((row) => row.handle)
  report('grantedScopes', grantedScopes)
  const shopResult = await request(`${base}/shop.json?fields=id,myshopify_domain,currency`)
  report('shopIdentity', pick(object(shopResult.body.shop), ['id', 'myshopify_domain', 'currency']))

  const headers: Row[] = []
  if (ids) {
    for (const id of ids) {
      const { body } = await request(`${base}/shopify_payments/payouts/${id}.json`)
      const payout = object(body.payout)
      if (String(payout.id) !== id) throw new Error('Payout header identity mismatch')
      headers.push(payout)
    }
  } else {
    const page = await request(`${base}/shopify_payments/payouts.json?limit=20`)
    const payouts = collection(page.body, 'payouts')
    report('payoutWindow', {
      count: payouts.length,
      hasMore: Boolean(page.next),
      statuses: histogram(payouts, 'status'),
      coverage: 'one recent header page; not historical coverage',
    })
    headers.push(...payouts.filter((row) => row.status === 'paid').slice(0, sampleSize))
    if (!headers.length) headers.push(...payouts.slice(0, sampleSize))
  }

  for (const header of headers) {
    report('payout', {
      fields: Object.keys(header).sort(),
      ...pick(header, PAYOUT_KEYS),
      summary: Object.fromEntries(
        Object.entries(object(header.summary)).filter(
          ([key, value]) =>
            key.endsWith('_amount') && typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)
        )
      ),
    })
    let next: string | null =
      `${base}/shopify_payments/balance/transactions.json?payout_id=${encodeURIComponent(String(header.id))}&limit=${pageSize}`
    const visited = new Set<string>()
    const itemIds = new Set<string>()
    const rows: Row[] = []
    let pages = 0
    while (next && pages < maxPages) {
      if (visited.has(next)) throw new Error('Repeated pagination URL')
      visited.add(next)
      const page = await request(next)
      const batch = collection(page.body, 'transactions')
      for (const row of batch) {
        if (row.id == null || itemIds.has(String(row.id)))
          throw new Error('Missing or duplicate item ID')
        if (String(row.payout_id) !== String(header.id))
          throw new Error('Payout filter returned another payout')
        itemIds.add(String(row.id))
      }
      rows.push(...batch)
      next = page.next
      pages++
    }
    report('items', {
      payoutId: header.id,
      count: rows.length,
      pages,
      complete: !next,
      fields: [...new Set(rows.flatMap((row) => Object.keys(row)))].sort(),
      types: histogram(rows, 'type'),
      sourceTypes: histogram(rows, 'source_type'),
      currencies: histogram(rows, 'currency'),
      test: histogram(rows, 'test'),
      withOrder: rows.filter((row) => row.source_order_id != null).length,
      withOrderTransaction: rows.filter((row) => row.source_order_transaction_id != null).length,
      withAdjustments: rows.filter(
        (row) =>
          Array.isArray(row.adjustment_order_transactions) &&
          row.adjustment_order_transactions.length > 0
      ).length,
      samples: [...new Map(rows.map((row) => [String(row.type), row])).values()]
        .slice(0, 12)
        .map(itemSample),
      comparison: reconcile(header, rows, !next),
    })
  }

  const pending = await request(
    `${base}/shopify_payments/balance/transactions.json?payout_status=pending&limit=10`
  )
  const pendingRows = collection(pending.body, 'transactions')
  report('pendingItemSample', {
    count: pendingRows.length,
    hasMore: Boolean(pending.next),
    unassigned: pendingRows.filter((row) => row.payout_id == null).length,
    samples: pendingRows.slice(0, 3).map(itemSample),
    coverage: 'one pending page; not complete account coverage',
  })

  // Schema and payout enrichment are separate from the REST evidence. GraphQL scope
  // failures must not erase a successful REST sample or imply the fields do not exist.
  try {
    const { body } = await request(
      `${base}/graphql.json`,
      `query PayoutProbeSchema {
      payout: __type(name: "ShopifyPaymentsPayout") { fields(includeDeprecated: true) { name isDeprecated deprecationReason } }
      account: __type(name: "ShopifyPaymentsAccount") { fields { name args { name } } }
      item: __type(name: "ShopifyPaymentsBalanceTransaction") { fields { name } }
    }`
    )
    report('graphqlSchema', body.data)
    const canReadBankAccounts = grantedScopes.includes('read_shopify_payments_bank_accounts')
    if (!canReadBankAccounts) {
      report('bankAccountInspection', 'Skipped: read_shopify_payments_bank_accounts is not granted')
    }
    const enrichment = await request(
      `${base}/graphql.json`,
      `query PayoutProbeAccount {
      shopifyPaymentsAccount { id payouts(first: 3, reverse: true) { nodes {
        id legacyResourceId status issuedAt transactionType net { amount currencyCode }
        ${canReadBankAccounts ? 'bankAccount { id currency }' : ''} externalTraceId
      } } }
    }`
    )
    report('graphqlPayouts', object(enrichment.body.data).shopifyPaymentsAccount)
  } catch (error) {
    report('optionalGraphqlUnavailable', error instanceof Error ? error.message : 'Request failed')
  }
  report(
    'limitations',
    'Bounded read-only sample. No database ingestion, Auxx order matching, bank match, or accounting posting tested. Exact agreement is not an atomic provider snapshot or a sink completion receipt.'
  )
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    // SQL/transport errors can contain connection details; expose only known probe errors.
    const message = error instanceof Error ? error.message : ''
    const safe =
      /^(Shopify HTTP|Expected one Shopify|Selected credential|Invalid |SHOP must|GraphQL returned|Refused |Payout |Missing |Unsafe |Repeated )/.test(
        message
      )
    report('failed', safe ? message : 'Probe failed before completion; no raw exception printed')
    process.exit(1)
  })
