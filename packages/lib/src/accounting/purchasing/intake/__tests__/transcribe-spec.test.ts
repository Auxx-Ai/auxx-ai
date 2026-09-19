// packages/lib/src/accounting/purchasing/intake/__tests__/transcribe-spec.test.ts
//
// §2.3: `transcribeQuote` becomes a thin caller of `transcribeDocument`, and
// must keep its exact return shape (`{ quote, extractedText }`) through the
// spec. No real model, storage or database involved — everything the pass
// touches is mocked the way `mail-classification/classify.test.ts` mocks the
// orchestrator.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  getCachedDefaultModel: vi.fn(),
  getAssetContent: vi.fn(),
  capabilities: null as Record<string, unknown> | null,
}))

vi.mock('../../../../cache/org-cache-helpers', () => ({
  getCachedDefaultModel: h.getCachedDefaultModel,
}))
vi.mock('../../../../ai/providers/provider-registry', () => ({
  ProviderRegistry: { getModelCapabilities: () => h.capabilities },
}))
vi.mock('../../../../ai/orchestrator/llm-orchestrator', () => ({
  LLMOrchestrator: class {
    invoke = h.invoke
  },
}))
vi.mock('../../../../ai/usage/usage-tracking-service', () => ({
  UsageTrackingService: class {},
}))
vi.mock('../../../../files/assets/content', () => ({
  getAssetContent: h.getAssetContent,
}))
vi.mock('../../../../files/storage/ports', () => ({
  createS3StoragePort: () => ({}),
}))

import { transcribeQuote } from '../transcribe'

const db = {} as never

const QUOTE_RESPONSE = {
  vendorName: 'Acme Fasteners GmbH',
  vendorEmail: 'sales@acme.example',
  vendorPhone: null,
  vendorAddress: null,
  quoteNumber: 'Q-77',
  quoteDate: '2026-09-01',
  validUntil: null,
  currency: 'eur',
  subtotalText: '210.00',
  shippingText: null,
  taxText: null,
  totalText: '210.00',
  lines: [
    {
      lineNumber: 1,
      vendorCode: 'AF-4420',
      description: 'Hex bolt M8x40 zinc',
      quantity: 500,
      unit: 'pcs',
      unitPriceText: '0.42',
      lineTotalText: '210.00',
      leadTime: null,
      priceBreaks: [],
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getCachedDefaultModel.mockResolvedValue({ provider: 'anthropic', model: 'claude-x' })
  h.capabilities = {
    displayName: 'Claude X',
    supports: { vision: true, fileInput: true, structured: true },
  }
  h.getAssetContent.mockResolvedValue({
    isErr: () => false,
    value: Buffer.from('%PDF-1.4 fake bytes'),
  })
  h.invoke.mockResolvedValue({ structured_output: QUOTE_RESPONSE, content: '' })
})

describe('transcribeQuote, through the transcribeDocument spec', () => {
  it('🔑 still returns { quote, extractedText }, unchanged for its callers', async () => {
    const result = await transcribeQuote(db, 'org_1', 'user_1', {
      assetRef: 'asset:abc123',
      fileName: 'quote.pdf',
      mimeType: 'application/pdf',
    })

    expect(result.isOk()).toBe(true)
    const { quote, extractedText } = result._unsafeUnwrap()
    expect(quote.quoteNumber).toBe('Q-77')
    expect(quote.currency).toBe('EUR')
    expect(quote.lines).toHaveLength(1)
    expect(quote.lines[0]?.vendorCode).toBe('AF-4420')
    // A PDF goes to the model as bytes; nothing was converted to text.
    expect(extractedText).toBeNull()
  })

  it('books the spend under purchase_intake, not a generic source', async () => {
    await transcribeQuote(db, 'org_1', 'user_1', {
      assetRef: 'asset:abc123',
      fileName: 'quote.pdf',
      mimeType: 'application/pdf',
    })

    expect(h.invoke).toHaveBeenCalledTimes(1)
    const request = h.invoke.mock.calls[0]?.[0]
    expect(request.context).toEqual({ source: 'purchase_intake' })
  })
})
