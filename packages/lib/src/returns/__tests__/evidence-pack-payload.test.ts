// packages/lib/src/returns/__tests__/evidence-pack-payload.test.ts

/**
 * `returns/evidence-pack-payload.ts` - plan section 7's six sections.
 *
 * The assembly is pure, so these are real assertions about the document a card
 * network would read, not about a fixture organization. What they pin:
 *
 * 1. **The dock case produces a pack.** No order, no contact, no ticket, no
 *    lines - section 3.2's 15 percent - and every section still renders,
 *    carrying the sentence that says why it is empty. A vanished section reads
 *    as "they did not look", and that is the reading that loses the dispute.
 * 2. **"Nothing there" and "we did not look" are different sentences.** An org
 *    with no `order` definition, a return with no order linked, and an order
 *    with no dispatch records are three different notes, not one.
 * 3. 🛑 **A missing delivery scan never blocks anything.** The
 *    `fulfillment_shipment` edge is null for almost every dispatch today (task
 *    55 section 2.2), so the dispatch renders with its tracking and carries a
 *    sentence saying the absence is not evidence of non-delivery.
 * 4. 🔑 **Call recordings and voicemails survive into the pack** with their
 *    date, duration and a resolvable reference, because a PDF cannot embed
 *    audio and an unreachable assertion is worth nothing in a rebuttal.
 */

import { describe, expect, it } from 'vitest'
import type { QuotePdfContact } from '../../documents/payload'
import type { ResolvedDocumentSettings } from '../../documents/resolve-settings'
import {
  assembleReturnEvidencePack,
  evidenceAttachmentHref,
  formatDuration,
  humanize,
} from '../evidence-pack-payload'
import type { ReturnEvidencePackSources } from '../evidence-pack-reads'
import type { ReturnWithLines } from '../reads'

const ORG = 'org_1'
const CREATED = new Date('2026-03-01T10:00:00.000Z')

const SETTINGS = {
  business: { companyName: 'Auxx Lift' },
  branding: { logo: null, accentColor: '', paperSize: 'letter', dateFormat: 'MMM d, yyyy' },
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
    footerText: '',
    lineDisplay: 'full',
    showDescriptions: true,
    showPaymentHistory: true,
  },
  currency: 'USD',
} as ResolvedDocumentSettings

const NO_CONTACT: QuotePdfContact = {
  name: '',
  email: null,
  phone: null,
  city: null,
  region: null,
  country: null,
}

/** A return carrying nothing but its own identity - the dock pallet. */
function dockReturn(overrides: Partial<ReturnWithLines> = {}): ReturnWithLines {
  return {
    returnId: 'ret_1',
    recordId: 'def_return:ret_1' as ReturnWithLines['recordId'],
    number: 'RMA-0001',
    status: 'received',
    origin: 'dock',
    reasons: [],
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
    ...overrides,
  }
}

function sourcesOf(overrides: Partial<ReturnEvidencePackSources> = {}): ReturnEvidencePackSources {
  return {
    returnRecord: dockReturn(),
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
    ...overrides,
  }
}

function pack(sources: ReturnEvidencePackSources) {
  return assembleReturnEvidencePack({
    organizationId: ORG,
    sources,
    contact: NO_CONTACT,
    settings: SETTINGS,
  })
}

describe('the dock case still produces a pack', () => {
  it('renders every section, each with the sentence that says why it is empty', () => {
    const payload = pack(sourcesOf())

    expect(payload.documentType).toBe('return_evidence_pack')
    expect(payload.number).toBe('RMA-0001')
    expect(payload.identified).toBe(false)
    // Not one of the six is silently absent.
    expect(payload.orderNote).toBeTruthy()
    expect(payload.dispatchNote).toBeTruthy()
    expect(payload.linesNote).toBeTruthy()
    expect(payload.correspondenceNote).toBeTruthy()
    expect(payload.moneyNote).toBeTruthy()
  })

  it('dates the pack from the return, never from the clock', () => {
    // A `new Date()` here would change the content hash on every call, which
    // re-renders and re-uploads the PDF forever with no error anywhere.
    expect(pack(sourcesOf()).issuedAt).toBe(CREATED.toISOString())
  })

  it('falls back to the instance id when the sequence hook has not minted a number', () => {
    const payload = pack(sourcesOf({ returnRecord: dockReturn({ number: null }) }))
    expect(payload.number).toBe('ret_1')
  })
})

describe('"nothing there" and "we did not look" are different sentences', () => {
  it('says so when the organization records no orders at all', () => {
    const payload = pack(sourcesOf({ ordersProvisioned: false }))
    expect(payload.orderNote).toContain('records no orders')
    expect(payload.order).toBeNull()
  })

  it('says something different when orders exist but none is linked', () => {
    const withOrders = pack(sourcesOf()).orderNote
    const withoutDef = pack(sourcesOf({ ordersProvisioned: false })).orderNote
    expect(withOrders).not.toBe(withoutDef)
    expect(withOrders).toContain('No order is linked')
  })

  it('separates no-dispatch-definition, no-order and no-dispatch-records', () => {
    const noDef = pack(sourcesOf({ dispatchesProvisioned: false })).dispatchNote
    const noOrder = pack(sourcesOf()).dispatchNote
    const noRecords = pack(
      sourcesOf({ order: { orderId: 'o1', number: 'SO-1' } as never })
    ).dispatchNote
    expect(new Set([noDef, noOrder, noRecords]).size).toBe(3)
    expect(noRecords).toContain('not a statement that nothing')
  })

  it('separates "no ticket linked" from "the ticket has no messages"', () => {
    const noTicket = pack(sourcesOf({ correspondenceSearched: false })).correspondenceNote
    const noMessages = pack(sourcesOf({ correspondenceSearched: true })).correspondenceNote
    expect(noTicket).toContain('No support ticket is linked')
    expect(noMessages).toContain('carries no messages')
  })
})

describe('section 2: the delivery scan is opportunistic and never blocking', () => {
  const dispatch = {
    fulfillmentId: 'f1',
    sequence: 1,
    name: null,
    status: 'shipped',
    shippedAt: '2026-02-01T12:00:00.000Z',
    trackingNumber: '1Z999',
    trackingCompany: 'UPS',
    trackingUrl: 'https://ups.example/1Z999',
    lines: [{ lineItemId: 'li_1', quantity: 2 }],
    shipmentId: null,
    parcels: [],
  }

  it('renders the dispatch with no shipment matched, and says the absence proves nothing', () => {
    const payload = pack(sourcesOf({ order: { orderId: 'o1' } as never, dispatches: [dispatch] }))

    expect(payload.dispatchNote).toBeNull()
    expect(payload.dispatches).toHaveLength(1)
    expect(payload.dispatches[0]!.trackingNumber).toBe('1Z999')
    expect(payload.dispatches[0]!.parcels).toEqual([])
    expect(payload.dispatches[0]!.deliveryNote).toContain('not evidence that delivery failed')
  })

  it('drops the caveat once a parcel actually carries a delivery scan', () => {
    const payload = pack(
      sourcesOf({
        order: { orderId: 'o1' } as never,
        dispatches: [
          {
            ...dispatch,
            shipmentId: 'ship_1',
            parcels: [
              {
                parcelId: 'p1',
                trackingNumber: '1Z999',
                status: 'delivered',
                statusDescription: 'Left at front door',
                deliveredAt: '2026-02-05T16:10:00.000Z',
                receivedBy: 'J SMITH',
              },
            ],
          },
        ],
      })
    )

    expect(payload.dispatches[0]!.deliveryNote).toBeNull()
    expect(payload.dispatches[0]!.parcels[0]!.deliveredAt).toBe('2026-02-05T16:10:00.000Z')
  })

  it('names the shipped line rather than printing a bare id', () => {
    const payload = pack(
      sourcesOf({
        order: { orderId: 'o1' } as never,
        dispatches: [dispatch],
        lineItems: new Map([
          [
            'li_1',
            {
              lineItemId: 'li_1',
              name: 'Scissor Lift 19ft',
              qty: 2,
              unitPriceMinor: 500000,
              lineTotalMinor: 1000000,
            },
          ],
        ]),
      })
    )
    expect(payload.dispatches[0]!.lines[0]!.name).toBe('Scissor Lift 19ft')
  })
})

describe('sections 3 and 4: the customer words and our findings', () => {
  const line = {
    returnLineId: 'rl_1',
    recordId: 'def_rl:rl_1' as ReturnWithLines['lines'][number]['recordId'],
    returnId: 'ret_1',
    lineItemId: 'li_1',
    partId: 'part_1',
    quantity: 1,
    customerReason: 'arrived_damaged',
    customerNote: 'The mast was bent when the pallet was opened.',
    conditionGrade: 'damaged_repairable' as const,
    liability: 'customer_damage' as const,
    inspectionNotes: 'Bend consistent with a forklift strike after delivery.',
    inspectedByUserId: 'u1',
    inspectedAt: new Date('2026-03-04T09:00:00.000Z'),
    createdAt: CREATED,
  }

  it('carries the customer words verbatim and the verdict beside them', () => {
    const payload = pack(
      sourcesOf({
        returnRecord: dockReturn({ lines: [line] }),
        partNames: new Map([['part_1', 'Scissor Lift 19ft']]),
      })
    )

    expect(payload.linesNote).toBeNull()
    const rendered = payload.lines[0]!
    expect(rendered.name).toBe('Scissor Lift 19ft')
    // Verbatim: the pack must not paraphrase what the customer said.
    expect(rendered.customerNote).toBe(line.customerNote)
    expect(rendered.conditionGrade).toBe('Damaged repairable')
    expect(rendered.liability).toBe('Customer damage')
    expect(rendered.customerWordsNote).toBeNull()
    expect(rendered.inspectionNote).toBeNull()
  })

  it('states an uninspected line rather than leaving the verdict blank', () => {
    const payload = pack(
      sourcesOf({
        returnRecord: dockReturn({
          lines: [
            {
              ...line,
              customerReason: null,
              customerNote: null,
              conditionGrade: null,
              liability: null,
              inspectionNotes: null,
              inspectedAt: null,
            },
          ],
        }),
      })
    )

    expect(payload.lines[0]!.customerWordsNote).toContain('no reason or note')
    expect(payload.lines[0]!.inspectionNote).toContain('has not been inspected')
  })

  it('carries photos with their capture timestamps, aligned index for index', () => {
    const payload = pack(
      sourcesOf({
        returnRecord: dockReturn({ lines: [line] }),
        photosByReturnLine: new Map([
          [
            'rl_1',
            [
              { ref: 'asset:a1', capturedAt: new Date('2026-03-04T09:05:00.000Z') },
              {
                ref: 'asset:a2',
                caption: 'Bent mast',
                capturedAt: new Date('2026-03-04T09:06:00.000Z'),
              },
            ],
          ],
        ]),
      })
    )

    // `render.ts` resolves photo bytes off `payload.lines[].photos` for EVERY
    // document type, so this shape is a contract rather than a convenience.
    expect(payload.lines[0]!.photos).toEqual([
      { ref: 'asset:a1' },
      { ref: 'asset:a2', caption: 'Bent mast' },
    ])
    expect(payload.lines[0]!.photoCapturedAt).toEqual([
      '2026-03-04T09:05:00.000Z',
      '2026-03-04T09:06:00.000Z',
    ])
  })

  it('puts the label and pallet shots on the header, not on a line', () => {
    const payload = pack(
      sourcesOf({
        returnPhotos: [{ ref: 'asset:label', capturedAt: new Date('2026-03-01T11:00:00.000Z') }],
      })
    )
    expect(payload.photos).toEqual([{ ref: 'asset:label' }])
    expect(payload.photoCapturedAt).toEqual(['2026-03-01T11:00:00.000Z'])
  })
})

describe('section 5: the calls are the point', () => {
  const base = {
    threadId: 't1',
    threadSubject: 'Damaged lift',
    isInbound: true,
    subject: null,
    snippet: null,
    body: null,
    bodyTruncated: false,
    callDurationSeconds: null,
    callAnswered: null,
    attachments: [],
  }

  it('lists a call recording with its date, duration and a resolvable reference', () => {
    const payload = pack(
      sourcesOf({
        correspondenceSearched: true,
        correspondence: [
          {
            ...base,
            messageId: 'msg_1',
            messageType: 'CALL',
            at: new Date('2026-03-02T15:30:00.000Z'),
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
      })
    )

    const message = payload.correspondence[0]!
    expect(payload.correspondenceNote).toBeNull()
    expect(message.kind).toBe('Call')
    expect(message.direction).toBe('Inbound')
    expect(message.at).toBe('2026-03-02T15:30:00.000Z')
    expect(message.duration).toBe('2:05')
    expect(message.callOutcome).toBe('Answered')
    // A PDF cannot embed audio, so the reference has to resolve for a reviewer.
    expect(message.attachments[0]).toMatchObject({
      audio: true,
      name: 'recording-0.mp3',
      href: '/api/attachments/att_1/download',
    })
  })

  it('recognises a voicemail as audio even when the mime type is missing', () => {
    const payload = pack(
      sourcesOf({
        correspondenceSearched: true,
        correspondence: [
          {
            ...base,
            messageId: 'msg_2',
            messageType: 'VOICEMAIL',
            at: new Date('2026-03-02T16:00:00.000Z'),
            callDurationSeconds: 31,
            callAnswered: false,
            attachments: [
              { attachmentId: 'att_2', title: 'voicemail.mp3', mimeType: null, sizeBytes: null },
            ],
          },
        ],
      })
    )

    expect(payload.correspondence[0]!.kind).toBe('Voicemail')
    expect(payload.correspondence[0]!.callOutcome).toBe('Not answered')
    expect(payload.correspondence[0]!.attachments[0]!.audio).toBe(true)
  })

  it('leaves duration and outcome null on a message that is not a call', () => {
    const payload = pack(
      sourcesOf({
        correspondenceSearched: true,
        correspondence: [
          {
            ...base,
            messageId: 'msg_3',
            messageType: 'EMAIL',
            at: new Date('2026-03-02T17:00:00.000Z'),
            subject: 'Re: Damaged lift',
            body: 'We received your photos.',
          },
        ],
      })
    )

    const message = payload.correspondence[0]!
    expect(message.kind).toBe('Email')
    expect(message.duration).toBeNull()
    expect(message.callOutcome).toBeNull()
    expect(message.attachments).toEqual([])
  })

  it('reports a truncated thread rather than quietly dropping the tail', () => {
    const payload = pack(sourcesOf({ correspondenceSearched: true, correspondenceTruncated: true }))
    expect(payload.correspondenceTruncated).toBe(true)
  })
})

describe('section 6: credited and withheld', () => {
  it('carries the memos and the withheld sentence, and drops the empty-money note', () => {
    const payload = pack(
      sourcesOf({
        returnRecord: dockReturn({
          goodsValue: 100000,
          creditedAmount: 80000,
          withheldAmount: 20000,
          withheldReason: 'Mast bent during the customer installation.',
          creditMemoIds: ['cm_1'],
        }),
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
      })
    )

    expect(payload.moneyNote).toBeNull()
    expect(payload.withheldAmountMinor).toBe(20000)
    expect(payload.withheldReason).toBe('Mast bent during the customer installation.')
    expect(payload.creditMemos[0]).toMatchObject({ number: 'CM-0001', source: 'Channel' })
  })

  it('states that nothing was credited rather than printing three blanks', () => {
    expect(pack(sourcesOf()).moneyNote).toContain('No credit memo is linked')
  })
})

describe('formatting helpers', () => {
  it('formats a call duration the way the Quo snippet does', () => {
    expect(formatDuration(125)).toBe('2:05')
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(null)).toBeNull()
  })

  it('humanizes a stored option value without inventing a label', () => {
    expect(humanize('damaged_by_customer')).toBe('Damaged by customer')
    // Null stays null: "not recorded" is a fact the pack states, not a gap.
    expect(humanize(null)).toBeNull()
  })

  it('points an attachment at the authenticated download route', () => {
    expect(evidenceAttachmentHref('att_9')).toBe('/api/attachments/att_9/download')
  })
})
