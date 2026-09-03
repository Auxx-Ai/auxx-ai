// apps/worker/scripts/profile-update-record.ts
/**
 * Census of the UPDATE path and the event pipeline behind it.
 *
 * For each scenario: runs one `handler.update` (or the tRPC panel's
 * `setValueWithBuiltIn`), counts every SQL statement at the pg CLIENT level,
 * every realtime frame, every bus event and every BullMQ job the write
 * produces. Then it plays the worker side inline: `persistEvent`, every
 * handler `EventHandlers[type]` lists, and `processWebhookJob`, counting SQL
 * per handler so the cost of one user edit is visible end to end.
 *
 * Queue adds and realtime provider calls are intercepted and NOT sent, so the
 * run is self-contained (no Redis, no Pusher, no live worker interference).
 *
 * Run (from repo root):
 *   TRACE=A node --conditions source --env-file .env --import tsx/esm \
 *     apps/worker/scripts/profile-update-record.ts
 */
import { database, schema } from '@auxx/database'
import { publisher } from '@auxx/lib/events'
import { EventHandlers, persistEvent } from '@auxx/lib/events/handlers'
import { FieldValueService } from '@auxx/lib/field-values'
import { isWebhookEvent, processWebhookJob } from '@auxx/lib/jobs'
import { getRealtimeService } from '@auxx/lib/realtime'
import { UnifiedCrudHandler } from '@auxx/lib/resources'
import { Queue } from 'bullmq'
import { and, eq, isNull } from 'drizzle-orm'

const ORG = process.env.PROFILE_ORG ?? 'abgwpa1l81reht2zmwrcihfu'
const TRACE = process.env.TRACE ?? ''

// ---------------------------------------------------------------- pg census
interface Stat {
  count: number
  totalMs: number
}
let stats = new Map<string, Stat>()
let trace: Array<{ text: string; tx: boolean }> = []
let tracing = false
let totalQueries = 0
let txQueries = 0
let totalQueryMs = 0

function norm(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/\$\d+/g, '?').trim()
}
function record(text: string, ms: number, inTx: boolean) {
  totalQueries++
  if (inTx) txQueries++
  totalQueryMs += ms
  if (tracing) trace.push({ text: norm(text).slice(0, 140), tx: inTx })
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
function reset() {
  stats = new Map()
  trace = []
  totalQueries = 0
  txQueries = 0
  totalQueryMs = 0
  realtimeFrames.length = 0
  busEvents.length = 0
  queueJobs.length = 0
}

// ----------------------------------------------------- side-channel census
const realtimeFrames: Array<{ room: string; event: string; bytes: number }> = []
const busEvents: any[] = []
const queueJobs: Array<{ queue: string; name: string }> = []

function installInterceptors() {
  const pool: any = (database as any).$client
  const origConnect = pool.connect.bind(pool)
  pool.connect = (...args: any[]) => {
    if (typeof args[0] === 'function') {
      const cb = args[0]
      return origConnect((e: any, c: any, r: any) => cb(e, c ? wrapClient(c) : c, r))
    }
    return origConnect(...args).then((c: any) => (c ? wrapClient(c) : c))
  }

  ;(getRealtimeService() as any).publish = async (room: string, event: string, data: unknown) => {
    realtimeFrames.push({ room, event, bytes: JSON.stringify(data ?? null).length })
    return true
  }

  // Every bus event, captured instead of enqueued. The worker side is replayed
  // by `replayWorker` below with the same counting.
  ;(publisher as any).publishLater = async (event: any) => {
    busEvents.push(event)
    queueJobs.push({ queue: 'events', name: 'publishEventJob' })
    if (isWebhookEvent(event.type)) queueJobs.push({ queue: 'webhooks', name: 'processWebhookJob' })
  }
  // Any other direct queue add (thumbnails, dedup scan, workflow enqueue...).
  Queue.prototype.add = async function (this: any, name: string) {
    queueJobs.push({ queue: this.name, name })
    return { id: 'stub', name } as any
  }
  Queue.prototype.addBulk = async function (this: any, jobs: Array<{ name: string }>) {
    for (const j of jobs) queueJobs.push({ queue: this.name, name: j.name })
    return jobs.map((j) => ({ id: 'stub', name: j.name })) as any
  }
}

// ---------------------------------------------------------------- worker replay
async function replayWorker(): Promise<Array<{ step: string; sql: number; ms: number }>> {
  const out: Array<{ step: string; sql: number; ms: number }> = []
  const events = [...busEvents]
  for (const event of events) {
    const runStep = async (label: string, fn: () => Promise<unknown>) => {
      const q0 = totalQueries
      const t0 = performance.now()
      try {
        await fn()
      } catch (e) {
        console.error(`   ${label} threw: ${e instanceof Error ? e.message : String(e)}`)
      }
      out.push({
        step: `${event.type} › ${label}`,
        sql: totalQueries - q0,
        ms: performance.now() - t0,
      })
    }
    await runStep('persistEvent', () => persistEvent(event))
    const entry = (EventHandlers as any)[event.type]
    const handlers: Array<(a: { data: any }) => unknown> = Array.isArray(entry)
      ? entry
      : entry
        ? [...entry.gate, ...entry.then]
        : []
    for (const h of handlers) {
      await runStep(h.name || 'anonymous', () => Promise.resolve(h({ data: event })))
    }
    if (isWebhookEvent(event.type)) {
      await runStep('processWebhookJob', () => processWebhookJob({ data: event } as any))
    }
    // Handlers that publish further events (field triggers, agents) land in
    // busEvents during replay; those are replayed too, once.
    for (const extra of busEvents.splice(events.length)) events.push(extra)
  }
  return out
}

// ---------------------------------------------------------------- scenarios
interface Scenario {
  key: string
  label: string
  run: () => Promise<unknown>
}

function report(
  label: string,
  wall: number,
  worker: Array<{ step: string; sql: number; ms: number }>
) {
  const writeSql = totalQueries - worker.reduce((n, w) => n + w.sql, 0)
  console.log(`\n${'='.repeat(78)}\n${label}\n${'='.repeat(78)}`)
  console.log(
    `WRITE:  ${wall.toFixed(0)}ms wall (${totalQueryMs.toFixed(0)}ms in SQL) | ` +
      `${writeSql} SQL (${txQueries} in a tx) | ` +
      `${realtimeFrames.length} realtime frames | ${busEvents.length} bus events | ${queueJobs.length} queue jobs`
  )
  if (realtimeFrames.length > 0) {
    const byEvent = new Map<string, { n: number; bytes: number }>()
    for (const f of realtimeFrames) {
      const s = byEvent.get(f.event) ?? { n: 0, bytes: 0 }
      s.n++
      s.bytes += f.bytes
      byEvent.set(f.event, s)
    }
    for (const [ev, s] of byEvent) console.log(`   realtime ${ev} ×${s.n} (${s.bytes} bytes)`)
  }
  for (const e of busEvents) console.log(`   bus ${e.type}`)
  const byJob = new Map<string, number>()
  for (const j of queueJobs)
    byJob.set(`${j.queue}/${j.name}`, (byJob.get(`${j.queue}/${j.name}`) ?? 0) + 1)
  for (const [k, n] of byJob) console.log(`   job ${k} ×${n}`)

  if (worker.length > 0) {
    const total = worker.reduce((n, w) => n + w.sql, 0)
    console.log(`WORKER: ${total} SQL across ${worker.length} handler runs`)
    for (const w of worker)
      console.log(`   ${String(w.sql).padStart(3)} SQL ${w.ms.toFixed(0).padStart(4)}ms  ${w.step}`)
  }
  console.log(`END TO END: ${totalQueries} SQL statements for this edit`)
}

function printStats(top = 22) {
  console.log('\n--- statements by count (write + worker) ---')
  const byCount = [...stats.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, top)
  for (const [text, s] of byCount) {
    console.log(
      `  n=${String(s.count).padStart(3)} ${s.totalMs.toFixed(0).padStart(5)}ms  ${text.slice(0, 125)}`
    )
  }
}

function printTrace() {
  console.log(`\n--- ordered trace of the WRITE (${trace.length} statements) ---`)
  trace.forEach((t, i) =>
    console.log(`${String(i + 1).padStart(3)} [${t.tx ? 'tx ' : 'POOL'}] ${t.text}`)
  )
}

async function main() {
  installInterceptors()

  const [member] = await database
    .select({ userId: schema.OrganizationMember.userId })
    .from(schema.OrganizationMember)
    .where(eq(schema.OrganizationMember.organizationId, ORG))
    .limit(1)
  if (!member) throw new Error(`no member for org ${ORG}`)
  const userId = member.userId

  const defs = await database
    .select({ id: schema.EntityDefinition.id, slug: schema.EntityDefinition.apiSlug })
    .from(schema.EntityDefinition)
    .where(eq(schema.EntityDefinition.organizationId, ORG))
  const def = (slug: string) => {
    const d = defs.find((x) => x.slug === slug)
    if (!d) throw new Error(`no def ${slug}`)
    return d.id
  }
  const sample = async (defId: string) => {
    const [inst] = await database
      .select({ id: schema.EntityInstance.id })
      .from(schema.EntityInstance)
      .where(
        and(
          eq(schema.EntityInstance.entityDefinitionId, defId),
          isNull(schema.EntityInstance.archivedAt)
        )
      )
      .limit(1)
    if (!inst) throw new Error(`no instance for ${defId}`)
    return `${defId}:${inst.id}` as any
  }
  const fieldId = async (defId: string, systemAttribute: string) => {
    const [f] = await database
      .select({ id: schema.CustomField.id })
      .from(schema.CustomField)
      .where(
        and(
          eq(schema.CustomField.entityDefinitionId, defId),
          eq(schema.CustomField.systemAttribute, systemAttribute)
        )
      )
    if (!f) throw new Error(`no field ${systemAttribute}`)
    return f.id
  }

  const contactDef = def('contacts')
  const contact = await sample(contactDef)
  const rateDef = def('tariff-rates')
  const rate = await sample(rateDef)
  const vendorPartDef = def('vendor-parts')
  const vendorPart = await sample(vendorPartDef)
  const jobTitleFieldId = await fieldId(contactDef, 'job_title')

  const handler = new UnifiedCrudHandler(ORG, userId)
  const service = new FieldValueService(ORG, userId)

  let tick = 0
  const stamp = () => `profile ${Date.now()}-${tick++}`

  const scenarios: Scenario[] = [
    {
      key: 'A',
      label: 'A. contact › handler.update, ONE plain TEXT field (job_title) changed',
      run: () => handler.update(contact, { job_title: stamp() }),
    },
    {
      key: 'B',
      label: 'B. contact › handler.update, same value again (idempotent)',
      run: async () => {
        const v = stamp()
        await handler.update(contact, { job_title: v })
        reset()
        const t0 = performance.now()
        await handler.update(contact, { job_title: v })
        return performance.now() - t0
      },
    },
    {
      key: 'C',
      label: 'C. contact › handler.update, THREE fields (first_name, job_title, city)',
      run: () =>
        handler.update(contact, { first_name: `Pf${tick++}`, job_title: stamp(), city: stamp() }),
    },
    {
      key: 'P',
      label: 'P. contact › tRPC panel path: FieldValueService.setValueWithBuiltIn (job_title)',
      run: () =>
        service.setValueWithBuiltIn({
          recordId: contact,
          fieldId: jobTitleFieldId,
          value: stamp(),
        }),
    },
    {
      key: 'R',
      label: 'R. tariff_rate › handler.update rate (native changed rule → part cost recalc)',
      run: () => handler.update(rate, { tariff_rate_rate: 10 + ((Date.now() + tick++) % 50) }),
    },
    {
      key: 'V',
      label: 'V. vendor_part › handler.update unit_price (native changed rule → part cost recalc)',
      run: () =>
        handler.update(vendorPart, { vendor_part_unit_price: 100 + ((Date.now() + tick++) % 500) }),
    },
  ]

  // Warm the org cache once so no scenario pays first-touch hydration.
  await handler.update(contact, { job_title: stamp() })

  for (const s of scenarios) {
    reset()
    tracing = TRACE.includes(s.key)
    const t0 = performance.now()
    const maybeWall = await s.run()
    const wall = typeof maybeWall === 'number' ? maybeWall : performance.now() - t0
    tracing = false
    const writeTrace = [...trace]
    const writeStats = new Map(stats)
    const writeTotals = { totalQueries, txQueries }
    const worker = await replayWorker()
    report(s.label, wall, worker)
    if (TRACE.includes(s.key)) {
      trace = writeTrace
      printTrace()
      const all = stats
      stats = writeStats
      console.log(`\n(write-only statements: ${writeTotals.totalQueries})`)
      printStats(30)
      stats = all
    }
  }

  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
