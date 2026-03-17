// packages/billing/src/__integration__/helpers/poll-helpers.ts
/**
 * Polling helpers for integration tests.
 * Since webhooks are delivered asynchronously by Stripe CLI, tests poll the DB
 * instead of asserting immediately.
 */

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'

/**
 * Generic poller. Retries until condition is true or timeout.
 */
export async function pollUntil<T>(opts: {
  queryFn: () => Promise<T>
  condition: (result: T) => boolean
  timeoutMs?: number
  pollIntervalMs?: number
  label?: string
}): Promise<T> {
  const {
    queryFn,
    condition,
    timeoutMs = 30_000,
    pollIntervalMs = 1_000,
    label = 'pollUntil',
  } = opts
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const result = await queryFn()
    if (condition(result)) {
      return result
    }
    await sleep(pollIntervalMs)
  }

  // One final attempt
  const finalResult = await queryFn()
  if (condition(finalResult)) {
    return finalResult
  }

  throw new Error(`${label}: condition not met within ${timeoutMs}ms`)
}

/** Convenience: poll subscription by ID until condition is met. */
export async function pollSubscription(
  db: Database,
  subscriptionId: string,
  condition: (sub: typeof schema.PlanSubscription.$inferSelect) => boolean,
  timeoutMs = 30_000
): Promise<typeof schema.PlanSubscription.$inferSelect> {
  return pollUntil({
    queryFn: async () => {
      const rows = await db
        .select()
        .from(schema.PlanSubscription)
        .where(eq(schema.PlanSubscription.id, subscriptionId))
        .limit(1)
      return rows[0] ?? null
    },
    condition: (sub) => sub !== null && condition(sub),
    timeoutMs,
    label: `pollSubscription(${subscriptionId})`,
  }) as Promise<typeof schema.PlanSubscription.$inferSelect>
}

/** Convenience: poll invoices for an org until condition is met. */
export async function pollInvoices(
  db: Database,
  organizationId: string,
  condition: (invoices: (typeof schema.Invoice.$inferSelect)[]) => boolean,
  timeoutMs = 30_000
): Promise<(typeof schema.Invoice.$inferSelect)[]> {
  return pollUntil({
    queryFn: async () => {
      return db
        .select()
        .from(schema.Invoice)
        .where(eq(schema.Invoice.organizationId, organizationId))
    },
    condition,
    timeoutMs,
    label: `pollInvoices(org:${organizationId})`,
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
