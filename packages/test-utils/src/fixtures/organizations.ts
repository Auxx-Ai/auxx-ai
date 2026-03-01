// packages/test-utils/src/fixtures/organizations.ts
// Test fixture for creating Organization records

import { Organization, type OrganizationEntity } from '@auxx/database'
import { createId } from '@paralleldrive/cuid2'
import { getTestDb } from '../globals'
import { createTestUser } from './users'

export type CreateTestOrganizationInput = Partial<typeof Organization.$inferInsert>

/** Insert a test organization. Creates an owner user if createdById is not provided. */
export async function createTestOrganization(
  overrides?: CreateTestOrganizationInput
): Promise<OrganizationEntity & { ownerId: string }> {
  const db = getTestDb()
  const id = overrides?.id ?? createId()

  // Organization requires a createdById (owner user)
  let ownerId = overrides?.createdById
  if (!ownerId) {
    const owner = await createTestUser({ name: 'Org Owner' })
    ownerId = owner.id
  }

  const [org] = await db
    .insert(Organization)
    .values({
      id,
      name: `Test Org ${id.slice(0, 6)}`,
      handle: `test-${id.slice(0, 8)}`,
      createdById: ownerId,
      updatedAt: new Date(),
      ...overrides,
    })
    .returning()

  return { ...org!, ownerId }
}
