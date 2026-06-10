// packages/lib/src/agents/procedures/__tests__/authoring-queries-publish.test.ts

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The chat-authoring write paths must emit the `procedure:updated` UI-refresh
 * event on success — and NOT on failure (STALE_DRAFT, db error). The realtime
 * module is mocked; we assert the publisher was invoked, not Pusher delivery.
 */

vi.mock('../../../realtime', () => ({
  getRealtimeService: vi.fn(() => ({ publish: vi.fn() })),
  publishProcedureUpdated: vi.fn(async () => {}),
}))

vi.mock('@auxx/database', () => ({
  database: { transaction: vi.fn() },
  schema: {},
}))

vi.mock('../queries', () => ({
  attachProcedureTx: vi.fn(),
  createProcedureTx: vi.fn(),
  updateProcedure: vi.fn(),
  writeDraftDocTx: vi.fn(),
}))

import { database } from '@auxx/database'
import { publishProcedureUpdated } from '../../../realtime'
import {
  createAttachedProcedureDraft,
  StaleDraftError,
  updateAttachedProcedureCriteria,
  updateAttachedProcedureDraftIfHash,
} from '../authoring/queries'
import { updateProcedure } from '../queries'

const transactionMock = vi.mocked(database.transaction)
const publishMock = vi.mocked(publishProcedureUpdated)
const updateProcedureMock = vi.mocked(updateProcedure)

const BASE = { organizationId: 'org-1', agentId: 'agent-1' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createAttachedProcedureDraft', () => {
  it('emits procedure:updated after the transaction commits', async () => {
    transactionMock.mockResolvedValue({ procedureId: 'proc-1', draftContentHash: 'h1' })

    const result = await createAttachedProcedureDraft({ ...BASE, name: 'Refunds' })

    expect(result.isOk()).toBe(true)
    expect(publishMock).toHaveBeenCalledTimes(1)
    expect(publishMock).toHaveBeenCalledWith(expect.anything(), 'org-1', {
      procedureId: 'proc-1',
      agentId: 'agent-1',
    })
  })

  it('does NOT emit when the transaction fails', async () => {
    transactionMock.mockRejectedValue(new Error('db down'))

    const result = await createAttachedProcedureDraft({ ...BASE, name: 'Refunds' })

    expect(result.isErr()).toBe(true)
    expect(publishMock).not.toHaveBeenCalled()
  })
})

describe('updateAttachedProcedureDraftIfHash', () => {
  const input = {
    ...BASE,
    procedureId: 'proc-1',
    expectedHash: 'h0',
    doc: { type: 'doc' as const, content: [] },
  }

  it('emits procedure:updated after a successful CAS write', async () => {
    transactionMock.mockResolvedValue({ draftContentHash: 'h1' })

    const result = await updateAttachedProcedureDraftIfHash(input)

    expect(result.isOk()).toBe(true)
    expect(publishMock).toHaveBeenCalledWith(expect.anything(), 'org-1', {
      procedureId: 'proc-1',
      agentId: 'agent-1',
    })
  })

  it('does NOT emit on STALE_DRAFT, and surfaces the STALE_DRAFT code', async () => {
    transactionMock.mockRejectedValue(new StaleDraftError())

    const result = await updateAttachedProcedureDraftIfHash(input)

    expect(result.isErr()).toBe(true)
    // Regression: `fromDatabase` wraps the thrown error — the StaleDraftError
    // rides on `cause`, and the mapped code must still be STALE_DRAFT (the
    // set_procedure_body tool branches on it to tell the model to re-read).
    expect(result.isErr() && (result.error as { code?: string }).code).toBe('STALE_DRAFT')
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('does NOT emit on a not-attached / db failure', async () => {
    transactionMock.mockRejectedValue(new Error('PROCEDURE_NOT_ATTACHED'))

    const result = await updateAttachedProcedureDraftIfHash(input)

    expect(result.isErr()).toBe(true)
    expect(result.isErr() && (result.error as { code?: string }).code).toBe('DATABASE_ERROR')
    expect(publishMock).not.toHaveBeenCalled()
  })
})

describe('updateAttachedProcedureCriteria', () => {
  const input = {
    ...BASE,
    procedureId: 'proc-1',
    patch: { name: 'Renamed', whenToUse: 'When refunds come up' },
  }

  it('emits procedure:updated after a successful criteria update', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: mock return shape only
    updateProcedureMock.mockResolvedValue(ok({ name: 'Renamed' }) as any)

    const result = await updateAttachedProcedureCriteria(input)

    expect(result.isOk()).toBe(true)
    expect(updateProcedureMock).toHaveBeenCalledWith({
      organizationId: 'org-1',
      procedureId: 'proc-1',
      patch: input.patch,
    })
    expect(publishMock).toHaveBeenCalledWith(expect.anything(), 'org-1', {
      procedureId: 'proc-1',
      agentId: 'agent-1',
    })
  })

  it('does NOT emit when the underlying update fails', async () => {
    updateProcedureMock.mockResolvedValue(
      // biome-ignore lint/suspicious/noExplicitAny: mock return shape only
      err({ code: 'DATABASE_ERROR', message: 'nope', cause: null }) as any
    )

    const result = await updateAttachedProcedureCriteria(input)

    expect(result.isErr()).toBe(true)
    expect(publishMock).not.toHaveBeenCalled()
  })
})
