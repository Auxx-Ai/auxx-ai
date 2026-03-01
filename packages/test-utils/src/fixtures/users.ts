// packages/test-utils/src/fixtures/users.ts
// Test fixture for creating User records

import { User, type UserEntity } from '@auxx/database'
import { createId } from '@paralleldrive/cuid2'
import { getTestDb } from '../globals'

export type CreateTestUserInput = Partial<typeof User.$inferInsert>

/** Insert a test user into the database with sensible defaults. */
export async function createTestUser(overrides?: CreateTestUserInput): Promise<UserEntity> {
  const db = getTestDb()
  const id = overrides?.id ?? createId()

  const [user] = await db
    .insert(User)
    .values({
      id,
      name: `Test User ${id.slice(0, 6)}`,
      email: `test-${id.slice(0, 6)}@test.local`,
      updatedAt: new Date(),
      ...overrides,
    })
    .returning()

  return user!
}
