// packages/test-utils/src/fixtures/connections.ts
// Test fixture for creating ConnectionDefinition records

import { ConnectionDefinition } from '@auxx/database'
import { createId } from '@paralleldrive/cuid2'
import { getTestDb } from '../globals'
import { createTestApp } from './apps'

export type CreateTestConnectionInput = Partial<typeof ConnectionDefinition.$inferInsert> & {
  appId?: string
  developerAccountId?: string
}

/** Insert a test connection definition. Creates an app if appId is not provided. */
export async function createTestConnection(
  overrides?: CreateTestConnectionInput
): Promise<typeof ConnectionDefinition.$inferSelect> {
  const db = getTestDb()
  const id = overrides?.id ?? createId()

  let appId = overrides?.appId
  let developerAccountId = overrides?.developerAccountId
  if (!appId) {
    const app = await createTestApp(developerAccountId ? { developerAccountId } : undefined)
    appId = app.id
    developerAccountId = app.developerAccountId
  }

  const [conn] = await db
    .insert(ConnectionDefinition)
    .values({
      id,
      appId,
      developerAccountId: developerAccountId!,
      major: 1,
      connectionType: 'none',
      label: `Test Connection ${id.slice(0, 6)}`,
      createdById: createId(),
      ...overrides,
    })
    .returning()

  return conn!
}
