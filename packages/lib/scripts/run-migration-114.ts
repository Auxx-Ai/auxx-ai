// packages/lib/scripts/run-migration-114.ts
//
// Runs entity-migration 114 (retire the gl_posting / gl_posting_line entity
// definitions, superseded by the GlPosting / GlPostingLine tables — decision
// G6) across every org.
//
// It exists for the same reason `run-migration-108.ts` does: the maintenance job
// records a migration as `applied` after its first run and will not repeat it,
// so a migration authored mid-development needs a door of its own.
//
// Idempotent — a second run finds no matching definitions and reports 0 changes.
//
// 🛑 It refuses, loudly and for the whole run, if any org still holds a
// gl_posting or gl_posting_line INSTANCE. That is the guard, not a warning:
// dropping a def with rows would destroy general-ledger history.
//
//   npx dotenv -- npx tsx packages/lib/scripts/run-migration-114.ts

import { database, schema } from '@auxx/database'
import { migration114RetireGlPostingDefs } from '../src/seed/entity-migrations/migrations/114-retire-gl-posting-defs'

async function main() {
  const orgs = await database.select({ id: schema.Organization.id }).from(schema.Organization)
  let changed = 0
  for (const org of orgs) {
    // `up()` drops the per-org caches for any org it changed, so this script
    // does not have to — the same contract `run-migration-108.ts` relies on.
    const result = await migration114RetireGlPostingDefs.up(database, org.id)
    if (!result.alreadyUpToDate) changed++
  }

  console.log(
    `114-retire-gl-posting-defs: ran over ${orgs.length} orgs, ${changed} reported changes`
  )
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
