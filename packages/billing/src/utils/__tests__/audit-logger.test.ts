// packages/billing/src/utils/__tests__/audit-logger.test.ts

import type { Database } from '@auxx/database'
import { describe, expect, it, vi } from 'vitest'
import { auditLog } from '../audit-logger'

vi.mock('@auxx/database', () => ({
  schema: {
    AdminActionLog: 'AdminActionLog',
  },
}))

function createMockDb() {
  const valuesMock = vi.fn().mockResolvedValue(undefined)
  const insertMock = vi.fn(() => ({ values: valuesMock }))
  return {
    db: { insert: insertMock } as unknown as Database,
    insertMock,
    valuesMock,
  }
}

describe('auditLog', () => {
  it('inserts correct record into AdminActionLog table', async () => {
    const { db, valuesMock } = createMockDb()

    await auditLog(db, {
      adminUserId: 'user_1',
      actionType: 'PLAN_CHANGE',
      targetType: 'subscription',
      targetId: 'sub_1',
      organizationId: 'org_1',
      details: { from: 'starter', to: 'pro' },
      reason: 'User requested upgrade',
      previousState: { plan: 'starter' },
      newState: { plan: 'pro' },
      ipAddress: '127.0.0.1',
      userAgent: 'Mozilla/5.0',
    })

    expect(valuesMock).toHaveBeenCalledTimes(1)
    const record = valuesMock.mock.calls[0][0]
    expect(record.adminUserId).toBe('user_1')
    expect(record.actionType).toBe('PLAN_CHANGE')
    expect(record.targetType).toBe('subscription')
    expect(record.targetId).toBe('sub_1')
    expect(record.organizationId).toBe('org_1')
    expect(record.details).toEqual({ from: 'starter', to: 'pro' })
    expect(record.reason).toBe('User requested upgrade')
    expect(record.ipAddress).toBe('127.0.0.1')
    expect(record.userAgent).toBe('Mozilla/5.0')
    expect(record.createdAt).toBeInstanceOf(Date)
  })

  it('handles optional fields as null', async () => {
    const { db, valuesMock } = createMockDb()

    await auditLog(db, {
      adminUserId: 'user_1',
      actionType: 'DELETE',
      targetType: 'subscription',
      targetId: 'sub_1',
    })

    const record = valuesMock.mock.calls[0][0]
    expect(record.organizationId).toBeNull()
    expect(record.details).toBeNull()
    expect(record.reason).toBeNull()
    expect(record.previousState).toBeNull()
    expect(record.newState).toBeNull()
    expect(record.ipAddress).toBeNull()
    expect(record.userAgent).toBeNull()
  })
})
