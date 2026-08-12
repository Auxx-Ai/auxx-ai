// packages/lib/src/workflow-engine/nodes/action-nodes/__tests__/answer-attachments.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowNode } from '../../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../../core/types'

/**
 * The Answer panel has always had an attachment picker; the processor never read
 * it. Anything a workflow author attached was silently dropped on both the send
 * and the draft path — the one failure mode a "message sent" trace can't reveal.
 *
 * These pin that the picker's rows survive to the send input as `attachmentIds`
 * (which `MessageSenderService.prepareAttachments` resolves against `MediaAsset`
 * then `FolderFile`) and to the draft's denormalized `DraftAttachment` rows.
 */

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(async (_input: any) => ({ id: 'msg_1', threadId: 't1' })),
  draftUpsert: vi.fn(async (_input: any) => ({ id: 'draft_1' })),
}))

vi.mock('../../../../resources/resource-fetcher', () => ({
  executeResourceQuery: vi.fn(async () => ({ id: 't1', integrationId: 'int1', subject: 'Hello' })),
}))
vi.mock('../../../../messages/message-sender.service', () => ({
  MessageSenderService: class {
    sendMessage = mocks.sendMessage
  },
}))
vi.mock('../../../../providers/provider-registry-service', () => ({
  ProviderRegistryService: class {},
}))
vi.mock('../../../../drafts/draft-service', () => ({
  DraftService: class {
    upsert = mocks.draftUpsert
  },
}))

const { AnswerProcessor } = await import('../answer')

const FILES = [
  { id: 'file_a', name: 'invoice.pdf', size: 1024, mimeType: 'application/pdf' },
  { id: 'file_b', name: 'photo.png', size: 2048, mimeType: 'image/png' },
]
const ASSETS = [{ id: 'asset_a', name: 'logo.svg', size: 512, mimeType: 'image/svg+xml' }]

/**
 * Branches on the `.select({...})` column keys, as `answer-node.test.ts` does:
 * Drizzle table objects are undefined under vitest so `.from()` identity checks
 * are unreliable. `name` + `mimeType` is the attachment hydration; the caller
 * distinguishes files from assets by which promise it awaits, so both are
 * returned in order of the two `select` calls the draft path makes.
 */
function makeMockDb() {
  let attachmentSelects = 0
  const select = vi.fn((cols?: Record<string, unknown>) => {
    const keys = cols ? Object.keys(cols) : []
    const resolve = () => {
      if (keys.includes('mimeType')) {
        // First attachment select is FolderFile, second is MediaAsset.
        attachmentSelects += 1
        return attachmentSelects === 1 ? FILES : ASSETS
      }
      if (keys.includes('email')) return [{ email: 'support@ourcompany.com' }]
      if (keys.includes('metadata')) return [{ id: 'm1', machineMailTier: null, metadata: null }]
      if (keys.includes('role')) return [{ role: 'FROM', identifier: 'customer@acme.com' }]
      return []
    }
    const builder: any = {
      from: () => builder,
      innerJoin: () => builder,
      where: () => builder,
      orderBy: () => builder,
      limit: () => resolve(),
      // biome-ignore lint/suspicious/noThenProperty: intentional thenable query-builder mock
      then: (onFulfilled: any, onRejected: any) =>
        Promise.resolve(resolve()).then(onFulfilled, onRejected),
    }
    return builder
  })
  return { select } as any
}

const makeContextManager = (db: any, variables: Record<string, unknown> = {}) =>
  ({
    getContext: () => ({ organizationId: 'org1', userId: 'u1', message: undefined, db }),
    interpolateVariables: async (t: string) => t,
    getVariable: async (key: string) => variables[key],
    isDebugMode: () => false,
    log: vi.fn(),
    setNodeVariable: vi.fn(),
  }) as any

const replyNode = (overrides: Record<string, unknown> = {}): WorkflowNode =>
  ({
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
      text: 'Here you go',
      ...overrides,
    },
  }) as unknown as WorkflowNode

const run = (overrides: Record<string, unknown>, variables?: Record<string, unknown>) =>
  (new AnswerProcessor() as any).executeNode(
    replyNode(overrides),
    makeContextManager(makeMockDb(), variables)
  )

const sentInput = () =>
  mocks.sendMessage.mock.calls[0]?.[0] as unknown as { attachmentIds?: string[] }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.sendMessage.mockResolvedValue({ id: 'msg_1', threadId: 't1' })
  mocks.draftUpsert.mockResolvedValue({ id: 'draft_1' })
})

describe('Answer node attachments reach the send path', () => {
  it("passes the picker's `file:` rows through as bare attachment ids", async () => {
    const result = await run({
      attachmentFiles: ['file:file_a', 'file:file_b'],
      attachmentFilesModes: [true, true],
      test_behavior: 'live',
    })

    expect(result.status).toBe(NodeRunningStatus.Succeeded)
    expect(sentInput().attachmentIds).toEqual(['file_a', 'file_b'])
  })

  it('resolves a variable row, including one that resolves to an array', async () => {
    await run(
      {
        attachmentFiles: ['{{extract_1.files}}'],
        attachmentFilesModes: [false],
        test_behavior: 'live',
      },
      { 'extract_1.files': ['file:file_a', 'file_b'] }
    )

    expect(sentInput().attachmentIds).toEqual(['file_a', 'file_b'])
  })

  it('unwraps a JSON-array row (several files picked into one row)', async () => {
    await run({
      attachmentFiles: ['["file:file_a","file:file_b"]'],
      attachmentFilesModes: [true],
      test_behavior: 'live',
    })

    expect(sentInput().attachmentIds).toEqual(['file_a', 'file_b'])
  })

  it('dedupes the same file picked twice', async () => {
    await run({
      attachmentFiles: ['file:file_a', 'file:file_a'],
      attachmentFilesModes: [true, true],
      test_behavior: 'live',
    })

    expect(sentInput().attachmentIds).toEqual(['file_a'])
  })

  it('sends no attachmentIds at all when nothing is attached', async () => {
    await run({ test_behavior: 'live' })
    expect(sentInput().attachmentIds).toBeUndefined()
  })

  it('reports the ids on the dry-run output instead of silently discarding them', async () => {
    const result = await run({
      attachmentFiles: ['file:file_a'],
      attachmentFilesModes: [true],
      test_behavior: 'dry_run',
    })

    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(result.output.attachmentIds).toEqual(['file_a'])
  })

  it('declares a variable row as a required variable', () => {
    const required = (new AnswerProcessor() as any).extractRequiredVariables(
      replyNode({ attachmentFiles: ['{{extract_1.files}}'], attachmentFilesModes: [false] })
    ) as string[]

    expect(required).toContain('extract_1.files')
  })
})

describe('Answer node attachments reach the draft path', () => {
  it('hydrates them into DraftAttachment rows from both tables', async () => {
    const result = await run({
      attachmentFiles: ['file:file_a', 'file:asset_a'],
      attachmentFilesModes: [true, true],
      test_behavior: 'draft',
    })

    expect(result.status).toBe(NodeRunningStatus.Succeeded)
    const content = (mocks.draftUpsert.mock.calls[0]?.[0] as any).content
    expect(content.attachments).toEqual([
      { id: 'file_a', name: 'invoice.pdf', size: 1024, mimeType: 'application/pdf', type: 'file' },
      { id: 'asset_a', name: 'logo.svg', size: 512, mimeType: 'image/svg+xml', type: 'asset' },
    ])
  })

  it('keeps an empty attachment list when nothing is attached', async () => {
    await run({ test_behavior: 'draft' })
    const content = (mocks.draftUpsert.mock.calls[0]?.[0] as any).content
    expect(content.attachments).toEqual([])
  })
})
