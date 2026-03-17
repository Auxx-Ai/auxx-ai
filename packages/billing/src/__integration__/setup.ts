// packages/billing/src/__integration__/setup.ts
/**
 * Global setup/teardown for billing integration tests.
 * Validates environment, seeds test data, and cleans up orphans.
 */

import { database } from '@auxx/database'
import { sql } from 'drizzle-orm'
import Stripe from 'stripe'
import { afterAll, beforeAll } from 'vitest'
import { cleanupAllTestData, seedTestPlans } from './helpers/db-helpers'
import { createTestStripePlans, deleteTestClock, TEST_PREFIX } from './helpers/stripe-helpers'

export const db = database
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-09-30.clover' as Stripe.LatestApiVersion,
})

beforeAll(async () => {
  // 1. Guard: must be test mode
  if (!process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) {
    throw new Error('STRIPE_SECRET_KEY must be a test key (sk_test_*)')
  }

  // 2. Guard: webhook secret must be set
  if (!process.env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_')) {
    throw new Error(
      'STRIPE_WEBHOOK_SECRET must be set to the whsec_* from `stripe listen --print-secret`'
    )
  }

  // 3. Verify DB connection
  await db.execute(sql`SELECT 1`)

  // 4. Health-check: dev server is running
  const res = await fetch('http://localhost:3000').catch(() => null)
  if (!res) {
    throw new Error('Dev server not running at localhost:3000. Run `pnpm dev` first.')
  }

  // 5. Create test Stripe products/prices (idempotent)
  const stripePlans = await createTestStripePlans(stripe)

  // 6. Seed DB plans with Stripe price IDs (idempotent)
  await seedTestPlans(db, stripePlans)

  // 7. Clean up orphaned test data from previous failed runs
  await cleanupAllTestData(db)
})

// NOTE: No afterAll cleanup here. Each test file handles its own cleanup
// in its own afterAll block. Since setupFiles runs per-file in vitest,
// a global afterAll here would destroy resources still needed by other files.
