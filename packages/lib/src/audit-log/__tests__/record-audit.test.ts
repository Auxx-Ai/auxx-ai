// packages/lib/src/audit-log/__tests__/record-audit.test.ts
//
// The one property this module exists to provide: on the default global `database`
// a failed insert is fire-and-forget (a Result, never a throw); on an explicit
// `db`/`Transaction` it must THROW so the caller's transaction rolls back instead of
// silently committing the change with no audit row.

import { describe, expect, it, vi } from 'vitest'

const { failingDatabase } = vi.hoisted(() => ({
  failingDatabase: { insert: vi.fn(() => ({ values: () => Promise.reject(new Error('boom')) })) },
}))

vi.mock('@auxx/database', () => ({
  AuditLog: {},
  database: failingDatabase,
  toAuditRow: (input: unknown) => input,
}))

import { recordAudit } from '../record-audit'
import type { AuditInput } from '../types'

const input: AuditInput = {
  organizationId: 'org_1',
  category: 'settings',
  action: 'setting.changed',
  actorType: 'user',
}

describe('recordAudit', () => {
  it('returns err rather than throwing when the default database insert fails', async () => {
    const result = await recordAudit(input)
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('AUDIT_WRITE_FAILED')
  })

  it('throws when an explicit db insert fails, so the caller transaction rolls back', async () => {
    const tx = { insert: vi.fn(() => ({ values: () => Promise.reject(new Error('boom')) })) }
    await expect(recordAudit(input, tx as never)).rejects.toThrow('boom')
  })

  it('does not throw for an explicit db insert that succeeds', async () => {
    const tx = { insert: vi.fn(() => ({ values: () => Promise.resolve() })) }
    const result = await recordAudit(input, tx as never)
    expect(result.isOk()).toBe(true)
  })
})
