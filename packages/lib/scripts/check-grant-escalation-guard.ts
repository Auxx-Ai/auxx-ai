// packages/lib/scripts/check-grant-escalation-guard.ts
//
// Dev util: prove plan 37 phase 1 against REAL postgres, without a browser.
//
// The escalation this guards is API-only — both grant surfaces gate on a
// client-side `useUser({ requireRoles: ['ADMIN','OWNER'] })`, and an admin
// already holds everything, so there is no UI repro. This drives
// `setGranteeLevels` directly with a chosen actor instead.
//
// It asserts three things and writes nothing durable:
//   1. a weak actor granting THEMSELVES `billing: Full` is refused
//   2. the refusal ROLLED BACK — no `PermissionGrant` row survives
//   3. the owner can still make the same grant (the §0.10 recovery guarantee)
//
// Requires: the org on a plan with `granularPermissions` (Growth/Enterprise),
// and an actor holding `permissions` but NOT `billing`. Pass ids as env vars:
//
//   ORG_ID=... ACTOR_ID=... OWNER_ID=... \
//   npx dotenv -- node --conditions source --import tsx/esm \
//     packages/lib/scripts/check-grant-escalation-guard.ts

import { database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { Area, Level, setGranteeLevels } from '../src/permissions/capabilities'
import { computeEffectiveStatesUncached } from '../src/permissions/profiles/effective-state'

const ORG_ID = process.env.ORG_ID
const ACTOR_ID = process.env.ACTOR_ID
const OWNER_ID = process.env.OWNER_ID
/**
 * The area to attempt a raise on. Must be one the actor does NOT already hold at
 * `Full` — composition is `max(base, maxOverGroups, user)`, so an area supplied
 * by ANY tier (a group grant is the easy one to miss) makes the attempt a no-op
 * raise that the guard correctly allows. The check below prints the composed
 * level first for exactly that reason.
 */
const AREA = (process.env.AREA ?? Area.members) as Area

async function grantRow(granteeId: string) {
  const [row] = await database
    .select({ levels: schema.PermissionGrant.levels })
    .from(schema.PermissionGrant)
    .where(
      and(
        eq(schema.PermissionGrant.organizationId, ORG_ID as string),
        eq(schema.PermissionGrant.granteeType, 'user'),
        eq(schema.PermissionGrant.granteeId, granteeId)
      )
    )
    .limit(1)
  return row?.levels
}

async function main() {
  if (!ORG_ID || !ACTOR_ID || !OWNER_ID) {
    console.error('Set ORG_ID, ACTOR_ID and OWNER_ID.')
    process.exit(1)
  }

  const before = await grantRow(ACTOR_ID)
  console.log('actor grant row BEFORE:', before ?? '(none)')

  // Fixture check FIRST. A raise the actor already composes is not an
  // escalation, and the guard allowing it is correct — so read the composed
  // level before concluding anything from a non-denial.
  const states = await computeEffectiveStatesUncached({
    organizationId: ORG_ID,
    userIds: [ACTOR_ID],
    tx: database,
  })
  const composed = states.get(ACTOR_ID)?.areas[AREA]
  console.log(`actor composes '${AREA}' at level ${composed} (0=None 1=Read 2=Edit 3=Full)`)
  if (composed === Level.Full) {
    console.error(
      `\nBAD FIXTURE: the actor already holds '${AREA}' at Full, so asking for Full raises\n` +
        'nothing and the guard will (correctly) allow it. Pick an area no profile, group\n' +
        'or user grant supplies — check their group memberships, not just their own row.'
    )
    process.exit(1)
  }

  // 1 + 2 — the self-grant must be refused, and must leave nothing behind.
  let denied: string | null = null
  try {
    await setGranteeLevels({
      organizationId: ORG_ID,
      granteeType: 'user',
      granteeId: ACTOR_ID,
      grantedById: ACTOR_ID,
      levels: { ...(before ?? {}), [AREA]: Level.Full },
    })
  } catch (error) {
    denied = error instanceof Error ? error.message : String(error)
  }

  const after = await grantRow(ACTOR_ID)
  console.log('actor grant row AFTER: ', after ?? '(none)')
  console.log(denied ? `DENIED  ✅  ${denied}` : 'NOT DENIED  ❌  the guard did not fire')

  const rolledBack = JSON.stringify(before ?? null) === JSON.stringify(after ?? null)
  console.log(rolledBack ? 'ROLLED BACK  ✅' : 'ROW SURVIVED  ❌  the throw did not undo the write')

  // 3 — an owner must still be able to make the same grant, or a mis-shaped
  // grant would be unrepairable by anyone.
  try {
    await setGranteeLevels({
      organizationId: ORG_ID,
      granteeType: 'user',
      granteeId: ACTOR_ID,
      grantedById: OWNER_ID,
      levels: { ...(before ?? {}), [AREA]: Level.Full },
    })
    console.log('OWNER GRANT ALLOWED  ✅')
  } catch (error) {
    console.log('OWNER GRANT REFUSED  ❌ ', error instanceof Error ? error.message : error)
  }

  // Restore whatever was there, so the script leaves no trace.
  if (before === undefined) {
    await database
      .delete(schema.PermissionGrant)
      .where(
        and(
          eq(schema.PermissionGrant.organizationId, ORG_ID),
          eq(schema.PermissionGrant.granteeType, 'user'),
          eq(schema.PermissionGrant.granteeId, ACTOR_ID)
        )
      )
  } else {
    await setGranteeLevels({
      organizationId: ORG_ID,
      granteeType: 'user',
      granteeId: ACTOR_ID,
      grantedById: OWNER_ID,
      levels: before,
    })
  }
  console.log('restored the original grant row.')
  process.exit(0)
}

void main()
