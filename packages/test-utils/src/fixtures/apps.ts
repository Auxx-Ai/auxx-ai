// packages/test-utils/src/fixtures/apps.ts
// Test fixture for creating App and DeveloperAccount records

import { App, DeveloperAccount } from '@auxx/database'
import { createId } from '@paralleldrive/cuid2'
import { getTestDb } from '../globals'

export type CreateTestDeveloperAccountInput = Partial<typeof DeveloperAccount.$inferInsert>

/** Insert a test developer account. */
export async function createTestDeveloperAccount(
  overrides?: CreateTestDeveloperAccountInput
): Promise<typeof DeveloperAccount.$inferSelect> {
  const db = getTestDb()
  const id = overrides?.id ?? createId()

  const [account] = await db
    .insert(DeveloperAccount)
    .values({
      id,
      slug: `dev-${id.slice(0, 8)}`,
      title: `Test Developer ${id.slice(0, 6)}`,
      ...overrides,
    })
    .returning()

  return account!
}

export type CreateTestAppInput = Partial<typeof App.$inferInsert> & {
  /** If no developerAccountId provided, creates one automatically. */
  developerAccountId?: string
}

/** Insert a test app. Creates a developer account if developerAccountId is not provided. */
export async function createTestApp(
  overrides?: CreateTestAppInput
): Promise<typeof App.$inferSelect> {
  const db = getTestDb()
  const id = overrides?.id ?? createId()

  let developerAccountId = overrides?.developerAccountId
  if (!developerAccountId) {
    const account = await createTestDeveloperAccount()
    developerAccountId = account.id
  }

  const [app] = await db
    .insert(App)
    .values({
      id,
      slug: `test-app-${id.slice(0, 8)}`,
      title: `Test App ${id.slice(0, 6)}`,
      developerAccountId,
      ...overrides,
    })
    .returning()

  return app!
}
