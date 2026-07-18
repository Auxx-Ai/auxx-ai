// packages/lib/src/workflow-engine/nodes/action-nodes/__tests__/answer-node.test.ts

import { ParticipantRole } from '@auxx/database/enums'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowNode } from '../../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../../core/types'
import { AnswerProcessor } from '../answer'

// getResource() goes through executeResourceQuery — mock it so the reply path can resolve
// a thread without a real DB.
vi.mock('../../../../resources/resource-fetcher', () => ({
  executeResourceQuery: vi.fn(async () => ({
    id: 't1',
    integrationId: 'int1',
    subject: 'Hello',
  })),
}))

/**
 * Chainable Drizzle-query mock. Drizzle schema table objects are undefined under vitest, so
 * `.from()` identity checks are unreliable — instead we branch on the `.select({...})` column
 * keys: `email` → Integration, `metadata` → latest inbound Message, `role` → MessageParticipant.
 */
function makeMockDb(cfg: {
  integrationEmail?: string
  latestMessage?: { id: string; metadata: unknown } | null
  participants?: Array<{ role: string; identifier: string }>
}) {
  const select = vi.fn((cols?: Record<string, unknown>) => {
    const keys = cols ? Object.keys(cols) : []
    const resolve = () => {
      if (keys.includes('email')) {
        return cfg.integrationEmail ? [{ email: cfg.integrationEmail }] : [{}]
      }
      if (keys.includes('metadata')) {
        return cfg.latestMessage ? [cfg.latestMessage] : []
      }
      if (keys.includes('role')) {
        return cfg.participants ?? []
      }
      return []
    }
    const builder: any = {
      from: () => builder,
      innerJoin: () => builder,
      where: () => builder,
      orderBy: () => builder,
      limit: () => resolve(),
      // Drizzle query builders are thenable — the mock must be too so `await db.select()...`
      // resolves at whichever terminal method the caller stops at (.where()/.limit()).
      // biome-ignore lint/suspicious/noThenProperty: intentional thenable query-builder mock
      then: (onFulfilled: any, onRejected: any) =>
        Promise.resolve(resolve()).then(onFulfilled, onRejected),
    }
    return builder
  })
  return { select } as any
}

describe('AnswerProcessor.getThreadParticipants (Reply-To preference)', () => {
  let processor: AnswerProcessor

  beforeEach(() => {
    processor = new AnswerProcessor()
  })

  const run = (
    participants: Array<{ role: string; identifier: string }>,
    integrationEmail = 'support@ourcompany.com'
  ) => {
    const db = makeMockDb({ integrationEmail, participants })
    return (processor as any).getThreadParticipants('m1', 'int1', db) as Promise<{
      sender: string | null
      otherRecipients: string[]
    }>
  }

  it('prefers REPLY_TO over FROM for the sender', async () => {
    const result = await run([
      { role: ParticipantRole.FROM, identifier: 'noreply@resend.com' },
      { role: ParticipantRole.REPLY_TO, identifier: 'support@resend.com' },
    ])
    expect(result.sender).toBe('support@resend.com')
  })

  it('falls back to FROM when there is no REPLY_TO', async () => {
    const result = await run([{ role: ParticipantRole.FROM, identifier: 'customer@acme.com' }])
    expect(result.sender).toBe('customer@acme.com')
  })

  it('skips a REPLY_TO that equals the integration email and falls back to FROM', async () => {
    const result = await run(
      [
        { role: ParticipantRole.FROM, identifier: 'customer@acme.com' },
        { role: ParticipantRole.REPLY_TO, identifier: 'Support@OurCompany.com' },
      ],
      'support@ourcompany.com'
    )
    expect(result.sender).toBe('customer@acme.com')
  })

  it('never includes the chosen sender in otherRecipients (dedupe)', async () => {
    const result = await run([
      { role: ParticipantRole.FROM, identifier: 'noreply@resend.com' },
      { role: ParticipantRole.REPLY_TO, identifier: 'support@resend.com' },
      { role: ParticipantRole.TO, identifier: 'support@resend.com' },
      { role: ParticipantRole.CC, identifier: 'other@acme.com' },
      { role: ParticipantRole.CC, identifier: 'Other@acme.com' },
    ])
    expect(result.sender).toBe('support@resend.com')
    expect(result.otherRecipients).toEqual(['other@acme.com'])
  })

  it('filters the integration email out of otherRecipients', async () => {
    const result = await run([
      { role: ParticipantRole.FROM, identifier: 'customer@acme.com' },
      { role: ParticipantRole.CC, identifier: 'support@ourcompany.com' },
      { role: ParticipantRole.CC, identifier: 'teammate@acme.com' },
    ])
    expect(result.sender).toBe('customer@acme.com')
    expect(result.otherRecipients).toEqual(['teammate@acme.com'])
  })
})

describe('AnswerProcessor.getLatestInboundMessage', () => {
  let processor: AnswerProcessor

  beforeEach(() => {
    processor = new AnswerProcessor()
  })

  it('returns the message id and metadata', async () => {
    const latestMessage = { id: 'm1', metadata: { machineMail: { tier: 'hard', reason: 'x' } } }
    const db = makeMockDb({ latestMessage })
    const result = await (processor as any).getLatestInboundMessage('t1', db)
    expect(result).toEqual(latestMessage)
  })

  it('returns null when there is no inbound message', async () => {
    const db = makeMockDb({ latestMessage: null })
    const result = await (processor as any).getLatestInboundMessage('t1', db)
    expect(result).toBeNull()
  })
})

describe('AnswerProcessor hard-tier machine-mail refusal backstop', () => {
  let processor: AnswerProcessor

  const makeContextManager = (db: any) => ({
    getContext: () => ({ organizationId: 'org1', userId: 'u1', message: undefined, db }),
    interpolateVariables: async (t: string) => t,
    getVariable: async () => undefined,
    isDebugMode: () => false,
    log: vi.fn(),
    setNodeVariable: vi.fn(),
  })

  const replyNode = (overrides: Record<string, unknown> = {}): WorkflowNode => ({
    id: 'answer_1',
    workflowId: 'wf_1',
    nodeId: 'answer_1',
    name: 'Answer',
    type: WorkflowNodeType.ANSWER,
    data: {
      id: 'answer_1',
      type: 'answer',
      title: 'Answer',
      messageType: 'reply',
      recordId: 'thread:t1',
      text: 'Thanks!',
      ...overrides,
    },
  })

  beforeEach(() => {
    processor = new AnswerProcessor()
  })

  it('refuses on the auto-To path when the latest inbound is hard-tier', async () => {
    const db = makeMockDb({
      latestMessage: {
        id: 'm1',
        metadata: { machineMail: { tier: 'hard', reason: 'delivery-status' } },
      },
    })
    await expect(
      (processor as any).executeNode(replyNode(), makeContextManager(db))
    ).rejects.toThrow(/Refusing to auto-reply to machine-generated mail \(delivery-status\)/)
  })

  it('refuses on the manual-To path too', async () => {
    const db = makeMockDb({
      latestMessage: {
        id: 'm1',
        metadata: { machineMail: { tier: 'hard', reason: 'null-return-path' } },
      },
    })
    const node = replyNode({ toIsAuto: false, to: ['someone@acme.com'], toModes: [true] })
    await expect((processor as any).executeNode(node, makeContextManager(db))).rejects.toThrow(
      /bounces\/NDRs must not be answered/
    )
  })

  it('does NOT refuse on soft-tier machine mail', async () => {
    const db = makeMockDb({
      latestMessage: { id: 'm1', metadata: { machineMail: { tier: 'soft', reason: 'list-id' } } },
    })
    // Manual To + dry_run so we exercise the refusal gate but stop before a real send.
    const node = replyNode({
      toIsAuto: false,
      to: ['someone@acme.com'],
      toModes: [true],
      test_behavior: 'dry_run',
    })
    const result = await (processor as any).executeNode(node, makeContextManager(db))
    expect(result.status).toBe(NodeRunningStatus.Succeeded)
    expect(result.output.dryRun).toBe(true)
  })
})
