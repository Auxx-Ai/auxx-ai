// packages/lib/src/events/handlers/flip-document-status-on-send.test.ts
// The confirmed-send status flip, once, for every send door (dispatch/money plan 22).
// The properties under test are the two that used to be spread across three hand-written
// router branches and could drift: the origin gate FAILS CLOSED, and a `BadRequestError`
// from `mark*Sent` is the idempotent no-op — not a failure.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  resolveThreadLinkedEntityIds: vi.fn(),
  documentTypeOf: vi.fn(),
  recordDocumentSendSignal: vi.fn(),
  markQuoteSent: vi.fn(),
  markPurchaseOrderSent: vi.fn(),
  instances: [] as { id: string; entityDefinitionId: string }[],
}))

vi.mock('@auxx/database', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  database: {
    select: () => ({ from: () => ({ where: async () => h.instances }) }),
  },
}))
vi.mock('../../entity-instances/activity', () => ({
  resolveThreadLinkedEntityIds: h.resolveThreadLinkedEntityIds,
}))
vi.mock('../../money/send-email', () => ({
  documentTypeOf: h.documentTypeOf,
  recordDocumentSendSignal: h.recordDocumentSendSignal,
  documentEmailProfile: (documentType: string) => ({
    sentSubjectFallback: `${documentType} sent`,
    markSent: documentType === 'purchase_order' ? h.markPurchaseOrderSent : h.markQuoteSent,
  }),
}))

import { BadRequestError } from '../../errors'
import { flipDocumentStatusOnSend } from './flip-document-status-on-send'

const BASE = {
  messageId: 'msg_1',
  organizationId: 'org_1',
  threadId: 'thr_1',
  userId: 'user_1',
  subject: 'Your quote',
}

function event(data: Record<string, unknown>) {
  return { data: { type: 'message:sent', data: { ...BASE, ...data } } } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  h.instances = [{ id: 'inst_quote', entityDefinitionId: 'def_quote' }]
  h.resolveThreadLinkedEntityIds.mockResolvedValue(['inst_quote'])
  h.documentTypeOf.mockResolvedValue('quote')
  h.markQuoteSent.mockResolvedValue(undefined)
  h.recordDocumentSendSignal.mockResolvedValue(undefined)
})

describe('flipDocumentStatusOnSend — the origin gate fails closed', () => {
  it('flips for a composed send', async () => {
    await flipDocumentStatusOnSend(event({ origin: 'compose' }))

    expect(h.markQuoteSent).toHaveBeenCalledWith({
      organizationId: 'org_1',
      userId: 'user_1',
      instanceId: 'inst_quote',
    })
    expect(h.recordDocumentSendSignal).toHaveBeenCalledWith(
      expect.objectContaining({ documentType: 'quote', documentInstanceId: 'inst_quote' })
    )
  })

  it('does nothing for a sequence step — a follow-up is not an issuance (§6.1)', async () => {
    await flipDocumentStatusOnSend(event({ origin: 'sequence' }))

    expect(h.resolveThreadLinkedEntityIds).not.toHaveBeenCalled()
    expect(h.markQuoteSent).not.toHaveBeenCalled()
    expect(h.recordDocumentSendSignal).not.toHaveBeenCalled()
  })

  it('does nothing when the origin is absent — a door that forgets flips nothing', async () => {
    await flipDocumentStatusOnSend(event({}))

    expect(h.markQuoteSent).not.toHaveBeenCalled()
  })

  it('ignores every event type but `message:sent`', async () => {
    await flipDocumentStatusOnSend({
      data: { type: 'message:received', data: { ...BASE, origin: 'compose' } },
    } as never)

    expect(h.resolveThreadLinkedEntityIds).not.toHaveBeenCalled()
  })
})

describe('flipDocumentStatusOnSend — what it does with the thread’s links', () => {
  it('skips a linked entity that is not a registered document type', async () => {
    h.instances = [{ id: 'inst_ticket', entityDefinitionId: 'def_ticket' }]
    h.resolveThreadLinkedEntityIds.mockResolvedValue(['inst_ticket'])
    h.documentTypeOf.mockRejectedValue(new BadRequestError('No document type is registered'))

    await flipDocumentStatusOnSend(event({ origin: 'compose' }))

    expect(h.markQuoteSent).not.toHaveBeenCalled()
    expect(h.recordDocumentSendSignal).not.toHaveBeenCalled()
  })

  it('still writes the send signal when the flip was an idempotent no-op (a resend)', async () => {
    h.markQuoteSent.mockRejectedValue(new BadRequestError("must be 'draft'"))

    await flipDocumentStatusOnSend(event({ origin: 'compose' }))

    expect(h.recordDocumentSendSignal).toHaveBeenCalledTimes(1)
  })

  it('does not let one failing document stop the next one', async () => {
    h.instances = [
      { id: 'inst_quote', entityDefinitionId: 'def_quote' },
      { id: 'inst_po', entityDefinitionId: 'def_po' },
    ]
    h.resolveThreadLinkedEntityIds.mockResolvedValue(['inst_quote', 'inst_po'])
    h.documentTypeOf.mockImplementation(async (_org: string, recordId: string) =>
      recordId.startsWith('def_po') ? 'purchase_order' : 'quote'
    )
    h.markQuoteSent.mockRejectedValue(new Error('database is on fire'))
    h.markPurchaseOrderSent.mockResolvedValue(undefined)

    await flipDocumentStatusOnSend(event({ origin: 'compose' }))

    expect(h.markPurchaseOrderSent).toHaveBeenCalledWith(
      expect.objectContaining({ instanceId: 'inst_po' })
    )
  })

  it('falls back to the profile’s subject when the send carried none', async () => {
    await flipDocumentStatusOnSend(event({ origin: 'compose', subject: undefined }))

    expect(h.recordDocumentSendSignal).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'quote sent' })
    )
  })

  it('no-ops on a thread with no linked entities', async () => {
    h.resolveThreadLinkedEntityIds.mockResolvedValue([])

    await flipDocumentStatusOnSend(event({ origin: 'compose' }))

    expect(h.markQuoteSent).not.toHaveBeenCalled()
  })
})
