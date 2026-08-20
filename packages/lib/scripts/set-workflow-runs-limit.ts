// packages/lib/scripts/set-workflow-runs-limit.ts
/**
 * Dev lever for testing the `workflowRuns` quota refusal on a real org.
 *
 * `PlanSubscription.customFeatureLimits` is the purpose-built per-org override —
 * `features-provider` merges it over the plan's map LAST and unconditionally, so
 * it works whatever the subscription's plan or status. Writing it is only half
 * the job: the `features` org-cache key is already warm in the running web/worker
 * processes, so the write is invisible until `onCacheEvent('plan.changed')` busts
 * it. Both halves are here.
 *
 * The usage counter itself lives in Redis at
 * `usage:<orgId>:workflowRuns:<YYYY-MM>` — `--reset-usage` clears it so a
 * scenario can be re-run without waiting for the month to roll over.
 *
 * This is the same thing the admin UI does
 * (`/admin/organizations/<id>` → Features → Save Custom Limits, which calls
 * `admin.billing.configureCustomLimits`). Use the UI when you have a superadmin
 * session; use this when you want it scripted or repeatable.
 *
 * Run (from repo root):
 *   npx dotenv -- npx tsx packages/lib/scripts/set-workflow-runs-limit.ts <org> <limit|clear> [--reset-usage]
 *
 *   <org>    organization id, or a case-insensitive name fragment
 *   <limit>  monthly hard cap to force (soft is set to the same), or `clear`
 *            to remove both keys and fall back to the plan
 *
 * Examples:
 *   … set-workflow-runs-limit.ts 'Koko Enterprise' 1 --reset-usage
 *   … set-workflow-runs-limit.ts 'Koko Enterprise' clear --reset-usage
 */

import { database } from '@auxx/database'
import { getRedisClient } from '@auxx/redis'
import { onCacheEvent } from '../src/cache'

const HARD = 'workflowRunsPerMonthHard'
const SOFT = 'workflowRunsPerMonthSoft'

function monthKey(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

async function resolveOrg(needle: string): Promise<{ id: string; name: string }> {
  const byId = await database.$client.query(
    'SELECT id, name FROM "Organization" WHERE id = $1 LIMIT 1',
    [needle]
  )
  if (byId.rows.length > 0) return byId.rows[0]

  const byName = await database.$client.query(
    'SELECT id, name FROM "Organization" WHERE name ILIKE $1 ORDER BY name LIMIT 5',
    [`%${needle}%`]
  )
  if (byName.rows.length === 0) throw new Error(`No organization matches "${needle}"`)
  if (byName.rows.length > 1) {
    throw new Error(
      `"${needle}" matches ${byName.rows.length} orgs: ${byName.rows
        .map((r: { name: string; id: string }) => `${r.name} (${r.id})`)
        .join(', ')}`
    )
  }
  return byName.rows[0]
}

async function main() {
  const [orgArg, limitArg, ...flags] = process.argv.slice(2)
  if (!orgArg || !limitArg) {
    console.error('usage: set-workflow-runs-limit.ts <org id|name> <limit|clear> [--reset-usage]')
    process.exit(1)
  }

  const clearing = limitArg === 'clear'
  const limit = clearing ? null : Number(limitArg)
  if (!clearing && (!Number.isInteger(limit) || (limit as number) < 0)) {
    throw new Error(`<limit> must be a non-negative integer or "clear", got "${limitArg}"`)
  }

  const org = await resolveOrg(orgArg)
  console.log(`org: ${org.name} (${org.id})`)

  const sub = await database.$client.query(
    'SELECT id, status, "customFeatureLimits" FROM "PlanSubscription" WHERE "organizationId" = $1 LIMIT 1',
    [org.id]
  )
  if (sub.rows.length === 0) {
    throw new Error(
      `${org.name} has no PlanSubscription row — nothing to override. Its features come ` +
        `from the demo/free fallback plan; give it a subscription first.`
    )
  }

  const raw = sub.rows[0].customFeatureLimits
  const current: Record<string, unknown> = (typeof raw === 'string' ? JSON.parse(raw) : raw) ?? {}
  console.log(`subscription: ${sub.rows[0].id} (${sub.rows[0].status})`)
  console.log(`before: ${JSON.stringify(current)}`)

  const next = { ...current }
  if (clearing) {
    delete next[HARD]
    delete next[SOFT]
  } else {
    next[HARD] = limit
    next[SOFT] = limit
  }

  const isEmpty = Object.keys(next).length === 0
  await database.$client.query(
    'UPDATE "PlanSubscription" SET "customFeatureLimits" = $1 WHERE "organizationId" = $2',
    [isEmpty ? null : JSON.stringify(next), org.id]
  )
  console.log(`after:  ${isEmpty ? 'null' : JSON.stringify(next)}`)

  // The write is invisible to a warm process until the `features` key is busted.
  await onCacheEvent('plan.changed', { orgId: org.id })
  console.log("busted the org's `features` cache key")

  const redis = await getRedisClient(true)
  const usageKey = `usage:${org.id}:workflowRuns:${monthKey()}`
  if (redis) {
    if (flags.includes('--reset-usage')) {
      await redis.del(usageKey)
      console.log(`usage:  reset ${usageKey} → 0`)
    } else {
      console.log(`usage:  ${usageKey} = ${(await redis.get(usageKey)) ?? '0'}`)
    }
  }

  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
