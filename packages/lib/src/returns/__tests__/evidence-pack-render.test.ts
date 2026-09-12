// packages/lib/src/returns/__tests__/evidence-pack-render.test.ts

/**
 * `<ReturnEvidencePackPdf>` actually renders.
 *
 * react-pdf validates its tree at RENDER time, not at compile time: a style
 * key it does not understand, a bare string outside a `<Text>`, or a `<View>`
 * nested somewhere it may not be are all type-clean and all throw only when
 * `renderToBuffer` runs. Every other guard in this module is on the payload,
 * so without this one the first person to find a broken layout is the person
 * generating a pack for a live chargeback.
 *
 * Two passes: a populated return that exercises every section including the
 * call recording, and the dock pallet that has nothing at all - because the
 * empty-section sentences are rendered by a different branch of the component
 * than the data is.
 *
 * No mocks. The only external input is the payload, which the pure assembly
 * produces; `logoBytes` and `photoBytes` are deliberately absent so the
 * fail-soft paths for both are covered too.
 */

import { renderToBuffer } from '@react-pdf/renderer'
import { createElement, type ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import type { QuotePdfContact } from '../../documents/payload'
import { ReturnEvidencePackPdf } from '../../documents/pdf/return-evidence-pack-pdf'
import type { ResolvedDocumentSettings } from '../../documents/resolve-settings'
import {
  assembleReturnEvidencePack,
  type ReturnEvidencePackPdfPayload,
} from '../evidence-pack-payload'
import type { ReturnEvidencePackSources } from '../evidence-pack-reads'
import type { ReturnLineRecord, ReturnWithLines } from '../reads'

const CREATED = new Date('2026-03-01T10:00:00.000Z')

const SETTINGS = {
  business: { companyName: 'Auxx Lift' },
  branding: { logo: null, accentColor: '#1d4ed8', paperSize: 'letter', dateFormat: 'MMM d, yyyy' },
  quote: {
    defaultTerms: '',
    validDays: 30,
    footerText: '',
    lineDisplay: 'full',
    showDescriptions: true,
  },
  invoice: {
    dueDays: 30,
    paymentInstructions: '',
    footerText: 'Confidential - prepared for dispute review',
    lineDisplay: 'full',
    showDescriptions: true,
    showPaymentHistory: true,
  },
  currency: 'USD',
} as ResolvedDocumentSettings

const CONTACT: QuotePdfContact = {
  name: '',
  email: null,
  phone: null,
  city: null,
  region: null,
  country: null,
}

const EMPTY_RETURN: ReturnWithLines = {
  returnId: 'ret_1',
  recordId: 'def_return:ret_1' as ReturnWithLines['recordId'],
  number: 'RMA-0001',
  status: 'received',
  origin: 'dock',
  reasons: [],
  customerNote: null,
  contactId: null,
  orderId: null,
  ticketId: null,
  requestedAt: null,
  receivedAt: null,
  inspectedAt: null,
  closedAt: null,
  senderNameRaw: null,
  senderAddressRaw: null,
  inboundCarrier: null,
  inboundTracking: null,
  labelProvided: null,
  labelCost: null,
  goodsValue: null,
  creditedAmount: null,
  withheldAmount: null,
  withheldReason: null,
  creditMemoIds: [],
  unidentified: true,
  creditedNotInspected: false,
  createdAt: CREATED,
  lines: [],
}

const LINE: ReturnLineRecord = {
  returnLineId: 'rl_1',
  recordId: 'def_rl:rl_1' as ReturnLineRecord['recordId'],
  returnId: 'ret_1',
  lineItemId: 'li_1',
  partId: 'part_1',
  quantity: 1,
  conditionGrade: 'damaged_repairable',
  liability: 'customer_damage',
  inspectionNotes: 'Bend consistent with a forklift strike after delivery.',
  inspectedByUserId: 'u1',
  inspectedAt: new Date('2026-03-04T09:00:00.000Z'),
  createdAt: CREATED,
}

const EMPTY_SOURCES: ReturnEvidencePackSources = {
  returnRecord: EMPTY_RETURN,
  contactRecordId: undefined,
  returnPhotos: [],
  photosByReturnLine: new Map(),
  order: null,
  ordersProvisioned: true,
  lineItems: new Map(),
  partNames: new Map(),
  dispatches: [],
  dispatchesProvisioned: true,
  correspondence: [],
  correspondenceSearched: false,
  correspondenceTruncated: false,
  creditMemos: [],
}

const FULL_SOURCES: ReturnEvidencePackSources = {
  ...EMPTY_SOURCES,
  returnRecord: {
    ...EMPTY_RETURN,
    status: 'inspected',
    reasons: ['damaged_by_customer'],
    customerNote: 'The mast was bent when the pallet was opened.',
    orderId: 'o1',
    ticketId: 't1',
    senderNameRaw: 'Acme Rigging',
    senderAddressRaw: '1 Dock Road, Newark NJ',
    inboundCarrier: 'UPS Freight',
    inboundTracking: '1Z-INBOUND',
    goodsValue: 100000,
    creditedAmount: 80000,
    withheldAmount: 20000,
    withheldReason: 'Mast bent during the customer installation.',
    creditMemoIds: ['cm_1'],
    lines: [LINE],
  },
  order: {
    orderId: 'o1',
    number: 'SO-9001',
    placedAt: '2026-01-10T00:00:00.000Z',
    currency: 'USD',
    financialStatus: 'paid',
    subtotalMinor: 90000,
    taxTotalMinor: 5000,
    shippingTotalMinor: 5000,
    totalMinor: 100000,
  },
  lineItems: new Map([
    [
      'li_1',
      {
        lineItemId: 'li_1',
        name: 'Scissor Lift 19ft',
        qty: 1,
        unitPriceMinor: 90000,
        lineTotalMinor: 90000,
      },
    ],
  ]),
  partNames: new Map([['part_1', 'Scissor Lift 19ft']]),
  dispatches: [
    {
      fulfillmentId: 'f1',
      sequence: 1,
      name: null,
      status: 'shipped',
      shippedAt: '2026-02-01T12:00:00.000Z',
      trackingNumber: '1Z999',
      trackingCompany: 'UPS',
      trackingUrl: 'https://ups.example/1Z999',
      lines: [{ lineItemId: 'li_1', quantity: 1 }],
      // 🛑 Null on purpose: the matched-shipment edge is empty for almost
      // every dispatch today, so this is the ordinary render, not the edge one.
      shipmentId: null,
      parcels: [],
    },
  ],
  correspondence: [
    {
      messageId: 'msg_1',
      threadId: 't1',
      threadSubject: 'Damaged lift',
      at: new Date('2026-03-02T15:30:00.000Z'),
      isInbound: true,
      messageType: 'CALL',
      subject: null,
      snippet: 'Call (2:05)',
      body: null,
      bodyTruncated: false,
      callDurationSeconds: 125,
      callAnswered: true,
      attachments: [
        {
          attachmentId: 'att_1',
          title: 'recording-0.mp3',
          mimeType: 'audio/mpeg',
          sizeBytes: 812345,
        },
      ],
    },
  ],
  correspondenceSearched: true,
  correspondenceTruncated: true,
  creditMemos: [
    {
      creditMemoId: 'cm_1',
      number: 'CM-0001',
      status: 'settled',
      source: 'channel',
      issuedAt: '2026-03-03T00:00:00.000Z',
      totalMinor: 80000,
      amountRefundedMinor: 80000,
    },
  ],
}

function payloadFor(sources: ReturnEvidencePackSources): ReturnEvidencePackPdfPayload {
  return assembleReturnEvidencePack({
    organizationId: 'org_1',
    sources,
    contact: CONTACT,
    settings: SETTINGS,
  })
}

/** react-pdf types its argument as the root `<Document>`; the component returns one. */
function render(payload: ReturnEvidencePackPdfPayload): Promise<Buffer> {
  return renderToBuffer(
    createElement(ReturnEvidencePackPdf, { payload }) as unknown as ReactElement<never>
  )
}

describe('the evidence pack renders to a PDF', () => {
  it('renders a populated return, recordings and all', async () => {
    const buffer = await render(payloadFor(FULL_SOURCES))
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(buffer.length).toBeGreaterThan(1000)
  }, 30_000)

  it('renders the dock pallet, whose every section is a sentence', async () => {
    const buffer = await render(payloadFor(EMPTY_SOURCES))
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(buffer.length).toBeGreaterThan(1000)
  }, 30_000)
})
