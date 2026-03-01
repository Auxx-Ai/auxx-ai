// packages/test-utils/src/__tests__/smoke.test.ts
// Smoke test to verify the test database infrastructure works end-to-end

import { User } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createTestOrganization, createTestUser } from '../fixtures'
import { getTestDb } from '../globals'
import { expectRecordCount } from '../helpers'

describe('test-utils smoke test', () => {
  it('should have a working database connection', async () => {
    const db = getTestDb()
    expect(db).toBeDefined()
  })

  it('should create and query a test user', async () => {
    const user = await createTestUser({ email: 'smoke@test.local' })

    expect(user).toBeDefined()
    expect(user.email).toBe('smoke@test.local')

    // Verify we can query it back
    const db = getTestDb()
    const found = await db.query.User.findFirst({
      where: eq(User.email, 'smoke@test.local'),
    })
    expect(found).toBeDefined()
    expect(found!.id).toBe(user.id)
  })

  it('should create a test organization with an owner', async () => {
    const org = await createTestOrganization({ name: 'Smoke Test Org' })

    expect(org).toBeDefined()
    expect(org.name).toBe('Smoke Test Org')
    expect(org.ownerId).toBeDefined()
  })

  it('should isolate data between tests (previous test data is gone)', async () => {
    await expectRecordCount('User', 0)
  })
})
