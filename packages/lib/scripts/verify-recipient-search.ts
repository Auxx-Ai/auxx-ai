// packages/lib/scripts/verify-recipient-search.ts
//
// Runs `searchRecipients` against the dev database on a real org.
//
// Rendered-SQL unit tests cannot catch a malformed CTE, a column that does not
// exist, or a `WHERE` fragment that lands in the wrong scope — all of which are
// syntax- or plan-level facts. This exercises every path once and prints the
// EXPLAIN for the two that carry the index requirements
// (`plans/email-editor/recipient-search.md` §10).
//
// Usage: npx dotenv -- npx tsx packages/lib/scripts/verify-recipient-search.ts [orgId]

import { database, schema } from '@auxx/database'
import { sql } from 'drizzle-orm'
import { searchRecipients } from '../src/participants/search/search-recipients'

const orgId = process.argv[2]

async function pickOrg(): Promise<string> {
  if (orgId) return orgId
  const rows = await database.execute(sql`
    SELECT "organizationId", count(*)::int AS n
    FROM ${schema.Participant}
    GROUP BY 1 ORDER BY n DESC LIMIT 1
  `)
  const row = rows.rows?.[0] as { organizationId?: string } | undefined
  if (!row?.organizationId) throw new Error('no org with participants found')
  return row.organizationId
}

async function show(label: string, run: () => ReturnType<typeof searchRecipients>) {
  const result = await run()
  if (result.isErr()) {
    console.log(`\n✗ ${label}\n  ERROR: ${result.error.message}`)
    return
  }
  const { candidates, truncated } = result.value
  // Invariants worth asserting rather than eyeballing: one row per identifier
  // (the arms are merged, so a person in both must appear once), and every row
  // carries something committable.
  const keys = candidates.map((c) => c.identifier.toLowerCase())
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i)
  const empty = candidates.filter((c) => !c.identifier?.trim())
  const flags = [
    dupes.length ? `🔴 DUPLICATE identifiers: ${[...new Set(dupes)].join(', ')}` : '',
    empty.length ? `🔴 ${empty.length} row(s) with no identifier` : '',
  ].filter(Boolean)
  console.log(`\n✓ ${label}  (${candidates.length} rows, truncated=${truncated})`)
  for (const flag of flags) console.log(`    ${flag}`)
  for (const c of candidates.slice(0, 5)) {
    console.log(
      `    [${c.source}] ${c.displayName} <${c.identifier}> ${c.identifierType} score=${c.score.toFixed(3)}`
    )
  }
}

async function main() {
  const organizationId = await pickOrg()
  console.log(`org: ${organizationId}`)

  await show('email / name query', () =>
    searchRecipients(database, { organizationId, query: 'klooth', model: 'email' })
  )
  await show('email / two-char query', () =>
    searchRecipients(database, { organizationId, query: 'kl', model: 'email' })
  )
  await show('email / bare domain', () =>
    searchRecipients(database, { organizationId, query: 'gmail', model: 'email' })
  )
  await show('email / empty query → most recently mailed', () =>
    searchRecipients(database, { organizationId, query: '', model: 'email' })
  )
  await show('phone / national US digits', () =>
    searchRecipients(database, { organizationId, query: '(415) 555', model: 'phone', region: 'US' })
  )
  await show('phone / national DE digits', () =>
    searchRecipients(database, {
      organizationId,
      query: '030 901820',
      model: 'phone',
      region: 'DE',
    })
  )
  await show('phone / name query on a phone channel', () =>
    searchRecipients(database, { organizationId, query: 'klooth', model: 'phone', region: 'US' })
  )
  await show('thread_only → contact arm skipped', () =>
    searchRecipients(database, { organizationId, query: 'klooth', model: 'thread_only' })
  )
  await show('platform_user → empty, NOT unfiltered', () =>
    searchRecipients(database, { organizationId, query: 'klooth', model: 'platform_user' })
  )
  await show('lens scoped to an inbox that matches nothing', () =>
    searchRecipients(database, {
      organizationId,
      query: 'klooth',
      model: 'email',
      threadVisibility: sql`${schema.Thread}."inboxId" = 'no-such-inbox'`,
    })
  )
  await show('contact scope resolved to none → participants still answer', () =>
    searchRecipients(database, {
      organizationId,
      query: 'klooth',
      model: 'email',
      contactVisibility: null,
    })
  )

  // §10's acceptance test: the participant OR block must plan as a BitmapOr.
  //
  // `enable_seqscan = off` is required for this to prove anything: the dev org has
  // ~5k participants, where a sequential scan is genuinely cheaper, so without it
  // the plan says nothing about whether the indexes CAN serve the block. The
  // question here is index-servability, not which plan wins at this size.
  console.log('\n--- EXPLAIN: participant arm (enable_seqscan=off) ---')
  await database.execute(sql`SET enable_seqscan = off`)
  const plan = await database.execute(sql`
    EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
    SELECT p."id" FROM ${schema.Participant} p
    WHERE p."organizationId" = ${organizationId}
      AND NOT p."isSpammer"
      AND (
        (p."displayName" % 'klooth' AND similarity(p."displayName", 'klooth') > 0.3)
        OR p."displayName" ILIKE '%klooth%'
        OR p."identifier" ILIKE '%klooth%'
      )
    LIMIT 20
  `)
  for (const row of plan.rows ?? [])
    console.log('   ', (row as Record<string, string>)['QUERY PLAN'])
  await database.execute(sql`RESET enable_seqscan`)

  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
