// packages/test-utils/src/helpers/create-test-caller.ts
// Factory for creating tRPC test callers with a real database

import { getTestDb } from '../globals'

/**
 * Creates a mock tRPC context suitable for testing protected procedures.
 * Consumers should cast this into the actual context type used by their router.
 */
export function createTestContext(overrides?: {
  userId?: string
  organizationId?: string
  isSuperAdmin?: boolean
}) {
  const db = getTestDb()

  return {
    db,
    session: {
      user: { id: overrides?.userId ?? 'test-user-id' },
      defaultOrganizationId: overrides?.organizationId ?? 'test-org-id',
      isSuperAdmin: overrides?.isSuperAdmin ?? false,
    },
    headers: new Headers(),
  }
}
