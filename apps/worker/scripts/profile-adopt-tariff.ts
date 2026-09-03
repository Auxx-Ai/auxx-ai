// apps/worker/scripts/profile-adopt-tariff.ts
/**
 * Times one `adoptTariffStarters` call and records every SQL statement it runs.
 *
 * Counts at the CLIENT level only - `pool.query()` delegates to a checked-out
 * client, so instrumenting both double-counts every non-transaction statement.
 *
 * Run (from repo root):
 *   TRACE=1 node --conditions source --env-file .env --import tsx/esm \
 *     apps/worker/scripts/profile-adopt-tariff.ts 8503.00.95.46 CN
 */
import { database, schema } from '@auxx/database'
import { adoptTariffStarters } from '@auxx/lib/bom'
import { UnifiedCrudHandler } from '@auxx/lib/resources'
import { eq, sql } from 'drizzle-orm'

const ORG = process.env.PROFILE_ORG ?? 'abgwpa1l81reht2zmwrcihfu'
const CODE = process.argv[2] ?? '8503.00.95.46'
const COUNTRY = process.argv[3] ?? 'CN'

interface Stat {
  count: number
  totalMs: number
}
const stats = new Map<string, Stat>()
const trace: Array<{ text: string; tx: boolean }> = []
let tracing = false
let totalQueries = 0
let txQueries = 0
let totalQueryMs = 0

function norm(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/\$\d+/g, '?').trim()
}

function record(text: string, ms: number, inTx: boolean) {
  if (process.env.LIVE === '1')
    console.log(`[${inTx ? 'tx ' : 'POOL'}] ${norm(text).slice(0, 110)}`)
  totalQueries++
  if (inTx) txQueries++
  totalQueryMs += ms
  if (tracing) trace.push({ text: norm(text).slice(0, 130), tx: inTx })
  const key = norm(text).slice(0, 200)
  const s = stats.get(key) ?? { count: 0, totalMs: 0 }
  s.count++
  s.totalMs += ms
  stats.set(key, s)
}

function wrapClient(client: any) {
  if (client.__wrapped) return client
  client.__wrapped = true
  client.__inTx = false
  const orig = client.query.bind(client)
  client.query = (...args: any[]) => {
    const first = args[0]
    const text = typeof first === 'string' ? first : (first?.text ?? String(first))
    const lowered = String(text).trim().toLowerCase()
    if (lowered.startsWith('begin')) client.__inTx = true
    const inTx = client.__inTx
    if (lowered.startsWith('commit') || lowered.startsWith('rollback')) client.__inTx = false
    const started = performance.now()
    const out = orig(...args)
    if (out && typeof out.then === 'function') {
      return out.finally(() => record(text, performance.now() - started, inTx))
    }
    record(text, performance.now() - started, inTx)
    return out
  }
  return client
}

// Matches on the code alone: the dev org holds one country per profiled code.
async function removeAdoptedPair(code: string, _country: string) {
  const rows = await database.execute(sql`
    SELECT ei.id FROM "EntityInstance" ei
    JOIN "EntityDefinition" ed ON ed.id = ei."entityDefinitionId"
    JOIN "FieldValue" c ON c."entityId" = ei.id
    JOIN "CustomField" cf ON cf.id = c."fieldId" AND cf."systemAttribute" = 'tariff_code_code'
    WHERE ei."organizationId" = ${ORG} AND ed."apiSlug" = 'tariff-codes'
      AND c."valueText" = ${code}
  `)
  const codeIds = (rows.rows as Array<{ id: string }>).map((r) => r.id)
  if (codeIds.length === 0) return
  const rates = await database.execute(sql`
    SELECT DISTINCT fv."entityId" AS id FROM "FieldValue" fv
    WHERE fv."organizationId" = ${ORG} AND fv."relatedEntityId" IN (${sql.join(
      codeIds.map((id) => sql`${id}`),
      sql`, `
    )})
  `)
  const ids = [...codeIds, ...(rates.rows as Array<{ id: string }>).map((r) => r.id)]
  await database.execute(
    sql`DELETE FROM "FieldValue" WHERE "organizationId" = ${ORG} AND ("entityId" IN (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `
    )}) OR "relatedEntityId" IN (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `
    )}))`
  )
  await database.execute(
    sql`DELETE FROM "EntityInstance" WHERE "organizationId" = ${ORG} AND id IN (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `
    )})`
  )
  console.log(`removed prior adoption: ${ids.length} rows`)
}

async function main() {
  const pool: any = (database as any).$client
  const origConnect = pool.connect.bind(pool)
  pool.connect = (...args: any[]) => {
    if (typeof args[0] === 'function') {
      const cb = args[0]
      return origConnect((e: any, c: any, r: any) => cb(e, c ? wrapClient(c) : c, r))
    }
    return origConnect(...args).then((c: any) => (c ? wrapClient(c) : c))
  }

  const [member] = await database
    .select({ userId: schema.OrganizationMember.userId })
    .from(schema.OrganizationMember)
    .where(eq(schema.OrganizationMember.organizationId, ORG))
    .limit(1)
  if (!member) throw new Error(`no member for org ${ORG}`)
  const userId = member.userId

  const origCreate = UnifiedCrudHandler.prototype.create
  const creates: Array<{ def: string; ms: number; queries: number }> = []
  UnifiedCrudHandler.prototype.create = async function (this: any, d: string, v: any, o?: any) {
    const q0 = totalQueries
    const t0 = performance.now()
    const traceThis = creates.length === 1 && process.env.TRACE === '1'
    if (traceThis) tracing = true
    try {
      return await origCreate.call(this, d, v, o)
    } finally {
      if (traceThis) tracing = false
      creates.push({ def: d, ms: performance.now() - t0, queries: totalQueries - q0 })
    }
  } as any

  await adoptTariffStarters(database, ORG, userId, {
    entries: [{ code: '0101.21.00.10', country: 'CN' }],
  })

  stats.clear()
  trace.length = 0
  totalQueries = 0
  txQueries = 0
  totalQueryMs = 0
  creates.length = 0

  // Measure a FRESH adopt: drop any earlier adoption of this pair (and its
  // rates) so the call writes instead of reporting `skipped`.
  await removeAdoptedPair(CODE, COUNTRY)

  const t0 = performance.now()
  const result = await adoptTariffStarters(database, ORG, userId, {
    entries: [{ code: CODE, country: COUNTRY }],
  })
  const elapsed = performance.now() - t0

  console.log('\n=== RESULT ===')
  console.log(result.isOk() ? JSON.stringify(result.value) : String(result.error))
  console.log(`\nTOTAL WALL: ${elapsed.toFixed(0)}ms`)
  console.log(
    `SQL: ${totalQueries} statements (${txQueries} inside the transaction, ` +
      `${totalQueries - txQueries} on a SEPARATE pool connection), ${totalQueryMs.toFixed(0)}ms in-query`
  )

  console.log('\n=== PER handler.create ===')
  for (const c of creates) {
    console.log(`  ${c.ms.toFixed(0).padStart(5)}ms  ${String(c.queries).padStart(4)} statements`)
  }

  if (trace.length > 0) {
    console.log(`\n=== ORDERED TRACE, ONE tariff_rate ROW (${trace.length} statements) ===`)
    trace.forEach((t, i) => {
      console.log(`${String(i + 1).padStart(3)} [${t.tx ? 'tx ' : 'POOL'}] ${t.text}`)
    })
  }

  console.log('\n=== BY COUNT ===')
  const byCount = [...stats.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 18)
  for (const [text, s] of byCount) {
    console.log(
      `  n=${String(s.count).padStart(4)}  ${s.totalMs.toFixed(0).padStart(5)}ms  ${text.slice(0, 120)}`
    )
  }

  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
