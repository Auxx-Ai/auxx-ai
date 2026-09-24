// packages/lib/src/mail-classification/__tests__/job.test.ts
// The job is orchestration only, so what is worth pinning is the ORDER and the
// two things that cost money or silence the feature:
//   • every guard exit short-circuits BEFORE the model call (C8);
//   • the §4.1 filter re-run happens whenever the marker was written (03 §5.1).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  guard: vi.fn(),
  classify: vi.fn(),
  apply: vi.fn(),
  mark: vi.fn(),
  triage: vi.fn(),
  rerun: vi.fn(),
}))

vi.mock('../classification-gate', () => ({ guardClassification: h.guard }))
vi.mock('../classify', () => ({ classifyMessage: h.classify }))
// ⚠️ PARTIAL. `toClassificationMarker` is kept REAL so the marker's contents are
// asserted against the actual builder rather than a paraphrase of it — and so a
// full replacement cannot silently hand `undefined` to `markMessageClassified`
// the next time this module grows an export.
vi.mock('../apply', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../apply')>()),
  applyClassificationTag: h.apply,
  markMessageClassified: h.mark,
  writeThreadTriage: h.triage,
}))
vi.mock('../rerun-filters', () => ({ rerunMailFiltersAfterClassification: h.rerun }))

import type { MailClassificationJobData } from '../job'
import { mailClassificationJob } from '../job'

const CONTEXT = {
  organizationId: 'org_1',
  messageId: 'msg_1',
  threadId: 'thr_1',
  inboxId: 'ibx_1',
  labels: [{ tagId: 'tag_billing', title: 'Billing', description: null }],
  message: { subject: 's', from: 'a@b.com', textPlain: 'b', senderAuthenticated: null },
}

const TRIAGE = {
  priority: 'HIGH',
  needsReply: true,
  sentiment: 'NEUTRAL',
  spamScore: 0.1,
  answers: {
    priority: { level: 3, confidence: 0.9 },
    needsReply: { probability: 0.8 },
    sentiment: { level: 3, confidence: 0.9 },
    spam: { probability: 0.1 },
  },
} as const

function ctx(data: Partial<MailClassificationJobData> = {}) {
  return {
    data: { organizationId: 'org_1', messageId: 'msg_1', threadId: 'thr_1', ...data },
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  h.guard.mockResolvedValue({ proceed: true, context: CONTEXT })
  h.classify.mockResolvedValue({
    tagId: 'tag_billing',
    confidence: 0.9,
    confidenceKind: 'self-reported',
    model: 'gpt-x',
    inferred: true,
    triage: TRIAGE,
  })
  h.apply.mockResolvedValue(true)
  h.mark.mockResolvedValue(undefined)
  h.rerun.mockResolvedValue(['flt_category'])
})

describe('mailClassificationJob — every guard exit short-circuits before the model call', () => {
  const REASONS = [
    'machine-mail',
    'no-thread',
    'inbox-not-opted-in',
    'no-eligible-tags',
    'already-classified',
    'thread-already-categorised',
  ] as const

  for (const reason of REASONS) {
    it(`exit "${reason}" costs no inference, no write and no filter re-run`, async () => {
      h.guard.mockResolvedValue({ proceed: false, reason })

      await expect(mailClassificationJob(ctx())).resolves.toEqual({
        classified: false,
        skipped: reason,
      })

      expect(h.classify).not.toHaveBeenCalled()
      expect(h.apply).not.toHaveBeenCalled()
      expect(h.mark).not.toHaveBeenCalled()
      expect(h.rerun).not.toHaveBeenCalled()
    })
  }

  it('a THROWING guard is a skip, never a job failure (a retry would re-infer)', async () => {
    h.guard.mockRejectedValue(new Error('db down'))

    await expect(mailClassificationJob(ctx())).resolves.toEqual({
      classified: false,
      skipped: 'error',
    })
    expect(h.classify).not.toHaveBeenCalled()
  })
})

describe('mailClassificationJob — the happy path', () => {
  it('applies the tag and THEN re-runs the filter engine (§4.1)', async () => {
    const order: string[] = []
    h.apply.mockImplementation(async () => {
      order.push('apply')
      return true
    })
    h.rerun.mockImplementation(async () => {
      order.push('rerun')
      return []
    })

    const result = await mailClassificationJob(ctx())

    expect(order).toEqual(['apply', 'rerun'])
    expect(result).toMatchObject({ classified: true, tagId: 'tag_billing', confidence: 0.9 })
  })

  it('⚠️ the re-run is MANDATORY — nothing else calls the engine for this message again', async () => {
    await mailClassificationJob(ctx())

    expect(h.rerun).toHaveBeenCalledWith({
      db: expect.anything(),
      organizationId: 'org_1',
      threadId: 'thr_1',
      messageId: 'msg_1',
    })
  })

  it('stamps the classification marker so the message is never re-inferred (C9)', async () => {
    await mailClassificationJob(ctx())

    expect(h.mark).toHaveBeenCalledTimes(1)
    expect(h.mark.mock.calls[0]?.[0]?.marker).toMatchObject({
      tagId: 'tag_billing',
      confidence: 0.9,
      model: 'gpt-x',
    })
  })

  it('carries the confidence kind and the raw triage answers onto the marker', async () => {
    await mailClassificationJob(ctx())

    expect(h.mark.mock.calls[0]?.[0]?.marker).toMatchObject({
      confidenceKind: 'self-reported',
      triage: TRIAGE.answers,
    })
  })

  it('writes the triage columns onto the classified thread', async () => {
    await mailClassificationJob(ctx())

    expect(h.triage).toHaveBeenCalledWith({
      db: expect.anything(),
      organizationId: 'org_1',
      threadId: 'thr_1',
      triage: TRIAGE,
    })
  })
})

describe('mailClassificationJob — nothing applied', () => {
  it('below threshold: marks and triages, applies no tag, still re-runs filters', async () => {
    h.classify.mockResolvedValue({
      tagId: null,
      confidence: 0.4,
      reason: 'below-threshold',
      model: 'gpt-x',
      inferred: true,
      triage: TRIAGE,
    })

    await expect(mailClassificationJob(ctx())).resolves.toEqual({
      classified: false,
      confidence: 0.4,
      skipped: 'below-threshold',
      firedFilterIds: ['flt_category'],
    })

    // The inference happened and was billed, so the marker still goes down; a
    // filter may condition on the triage columns alone (03 §5.1).
    expect(h.mark).toHaveBeenCalledTimes(1)
    expect(h.triage).toHaveBeenCalledTimes(1)
    expect(h.apply).not.toHaveBeenCalled()
    expect(h.rerun).toHaveBeenCalledTimes(1)
  })

  it('no default model: NO marker, so the message stays classifiable once one is set', async () => {
    h.classify.mockResolvedValue({
      tagId: null,
      confidence: 0,
      reason: 'no-default-model',
      inferred: false,
    })

    await mailClassificationJob(ctx())

    expect(h.mark).not.toHaveBeenCalled()
  })

  // ⚠️ THE REGRESSION. A failed call spends nothing and decides nothing, so the
  // C9 marker must not go down — stamping it disqualified the message from ever
  // being classified, permanently, for a condition that usually clears by
  // itself. The marker is gated on `inferred`, never on the reason.
  for (const reason of ['quota-exceeded', 'unavailable', 'error'] as const) {
    it(`"${reason}": NO marker, so the message stays classifiable`, async () => {
      h.classify.mockResolvedValue({
        tagId: null,
        confidence: 0,
        reason,
        model: 'gpt-x',
        inferred: false,
      })

      await expect(mailClassificationJob(ctx())).resolves.toEqual({
        classified: false,
        confidence: 0,
        skipped: reason,
      })

      expect(h.mark).not.toHaveBeenCalled()
      expect(h.triage).not.toHaveBeenCalled()
      expect(h.apply).not.toHaveBeenCalled()
      expect(h.rerun).not.toHaveBeenCalled()
    })
  }

  it('stamps on `inferred`, NOT on the reason — a new failure arm cannot inherit "stamp"', async () => {
    // A reason the marker gate has never heard of. If the gate ever goes back to
    // enumerating reasons, this is what catches it: an unrecognised failure must
    // default to "stays classifiable", not to "done forever".
    h.classify.mockResolvedValue({
      tagId: null,
      confidence: 0,
      reason: 'some-future-failure',
      inferred: false,
    })

    await mailClassificationJob(ctx())

    expect(h.mark).not.toHaveBeenCalled()
  })

  it('a failed tag write reports an error but still re-runs filters over the triage', async () => {
    h.apply.mockResolvedValue(false)

    await expect(mailClassificationJob(ctx())).resolves.toMatchObject({
      classified: false,
      skipped: 'error',
    })
    expect(h.rerun).toHaveBeenCalledTimes(1)
  })
})
