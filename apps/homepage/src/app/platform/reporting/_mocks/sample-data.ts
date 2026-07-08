// apps/homepage/src/app/platform/reporting/_mocks/sample-data.ts

/**
 * All hardcoded series for the reporting-page chart mocks live here so the
 * numbers stay consistent with the surrounding copy. Chart slot colors are
 * defined in `mock-card.tsx` (`CHART_VARS_CLASS`).
 */

/** Hero KPI — "AI-resolved this week" */
export const AI_RESOLVED_KPI = {
  value: 1284,
  deltaLabel: '▲ 18%',
  spark: [
    { x: 'W1', y: 640 },
    { x: 'W2', y: 720 },
    { x: 'W3', y: 690 },
    { x: 'W4', y: 810 },
    { x: 'W5', y: 900 },
    { x: 'W6', y: 980 },
    { x: 'W7', y: 1090 },
    { x: 'W8', y: 1284 },
  ],
}

/** Hero + featured — "Median resolution time" in minutes, Email vs Chat, trending down */
export const RESOLUTION_TIME = [
  { week: 'W1', email: 96, chat: 45 },
  { week: 'W2', email: 88, chat: 41 },
  { week: 'W3', email: 91, chat: 38 },
  { week: 'W4', email: 74, chat: 33 },
  { week: 'W5', email: 66, chat: 29 },
  { week: 'W6', email: 58, chat: 24 },
  { week: 'W7', email: 47, chat: 21 },
  { week: 'W8', email: 41, chat: 18 },
]

/** Hero + customize — "Tickets by team" */
export const TICKETS_BY_TEAM = [
  { name: 'Support', value: 342 },
  { name: 'Success', value: 187 },
  { name: 'Ops', value: 96 },
]

/** Featured — "Support Performance" donut */
export const TICKET_STATUS = [
  { key: 'resolved', name: 'Resolved', value: 812 },
  { key: 'open', name: 'Open', value: 264 },
  { key: 'escalated', name: 'Escalated', value: 118 },
]

/** Featured + grid — "AI-resolved %" over 8 weeks, climbing */
export const AI_IMPACT = [
  { week: 'W1', rate: 22 },
  { week: 'W2', rate: 28 },
  { week: 'W3', rate: 31 },
  { week: 'W4', rate: 38 },
  { week: 'W5', rate: 42 },
  { week: 'W6', rate: 47 },
  { week: 'W7', rate: 53 },
  { week: 'W8', rate: 58 },
]

/** Featured + grid — "Contacts by company" */
export const CONTACTS_BY_COMPANY = [
  { name: 'Acme Inc', value: 124 },
  { name: 'Northwind', value: 98 },
  { name: 'Globex', value: 76 },
  { name: 'Initech', value: 61 },
  { name: 'Umbrella', value: 43 },
]

export interface DrillDownTicket {
  id: string
  subject: string
  contact: string
  status: 'Open' | 'Resolved' | 'Escalated'
}

/** Drill-down — tickets grouped by tag, each with its underlying records */
export const TICKETS_BY_TAG: {
  tag: string
  count: number
  tickets: DrillDownTicket[]
}[] = [
  {
    tag: 'Refunds',
    count: 48,
    tickets: [
      { id: '#4821', subject: 'Refund for damaged blender', contact: 'Mia Chen', status: 'Open' },
      { id: '#4809', subject: 'Double charge on order 1042', contact: 'Leo Park', status: 'Open' },
      {
        id: '#4793',
        subject: 'Return label never arrived',
        contact: 'Ana Souza',
        status: 'Resolved',
      },
      { id: '#4771', subject: 'Partial refund request', contact: 'Tom Hale', status: 'Escalated' },
    ],
  },
  {
    tag: 'Shipping',
    count: 36,
    tickets: [
      { id: '#4830', subject: 'Package stuck in transit', contact: 'Ravi Patel', status: 'Open' },
      { id: '#4812', subject: 'Wrong address on order', contact: 'Emma Voss', status: 'Resolved' },
      { id: '#4788', subject: 'Expedite to overnight?', contact: 'Kai Tanaka', status: 'Resolved' },
    ],
  },
  {
    tag: 'Returns',
    count: 29,
    tickets: [
      {
        id: '#4825',
        subject: 'Exchange for a larger size',
        contact: 'Sofia Marin',
        status: 'Open',
      },
      { id: '#4801', subject: 'Return window question', contact: 'Jon Berg', status: 'Resolved' },
      { id: '#4779', subject: 'Item arrived opened', contact: 'Lena Kroll', status: 'Escalated' },
    ],
  },
  {
    tag: 'Billing',
    count: 18,
    tickets: [
      { id: '#4818', subject: 'Update card on file', contact: 'Omar Aziz', status: 'Resolved' },
      { id: '#4795', subject: 'Invoice for order 1031', contact: 'Ines Roca', status: 'Open' },
    ],
  },
]

/** Grid — tickets created per day (last 14 days) */
export const TICKETS_PER_DAY = [
  { day: '1', value: 34 },
  { day: '2', value: 41 },
  { day: '3', value: 38 },
  { day: '4', value: 52 },
  { day: '5', value: 47 },
  { day: '6', value: 22 },
  { day: '7', value: 18 },
  { day: '8', value: 44 },
  { day: '9', value: 49 },
  { day: '10', value: 55 },
  { day: '11', value: 43 },
  { day: '12', value: 51 },
  { day: '13', value: 27 },
  { day: '14', value: 24 },
]

/** Grid — CSAT trend */
export const CSAT_TREND = [
  { week: 'W1', score: 4.2 },
  { week: 'W2', score: 4.3 },
  { week: 'W3', score: 4.2 },
  { week: 'W4', score: 4.4 },
  { week: 'W5', score: 4.5 },
  { week: 'W6', score: 4.6 },
  { week: 'W7', score: 4.7 },
  { week: 'W8', score: 4.8 },
]

/** Dashboard-grid mock — compact record list */
export const RECENT_TICKETS: DrillDownTicket[] = [
  { id: '#4832', subject: 'Where is my order?', contact: 'Nora Vik', status: 'Open' },
  { id: '#4831', subject: 'Cancel subscription', contact: 'Sam Ortiz', status: 'Open' },
  { id: '#4829', subject: 'Warranty on mixer', contact: 'Ada Lin', status: 'Resolved' },
]

// ── Customize-section config matrix ─────────────────────────────────────────
// Tickets total 625 this quarter, contacts total 402 — every category split
// below sums to those totals so the preview stays coherent while switching.

export const TICKETS_BY_CHANNEL = [
  { name: 'Email', value: 402 },
  { name: 'Chat', value: 148 },
  { name: 'Social', value: 75 },
]

export const TICKETS_BY_TAG_QUARTER = [
  { name: 'Refunds', value: 214 },
  { name: 'Shipping', value: 168 },
  { name: 'Returns', value: 133 },
  { name: 'Billing', value: 110 },
]

export const CONTACTS_BY_TAG = [
  { name: 'Customer', value: 214 },
  { name: 'Lead', value: 118 },
  { name: 'VIP', value: 70 },
]

/** AI-resolved % per category slice */
export const AI_RATE_BY_TEAM = [
  { name: 'Support', value: 52 },
  { name: 'Success', value: 61 },
  { name: 'Ops', value: 48 },
]

export const AI_RATE_BY_CHANNEL = [
  { name: 'Email', value: 55 },
  { name: 'Chat', value: 66 },
  { name: 'Social', value: 41 },
]

export const AI_RATE_BY_TAG = [
  { name: 'Refunds', value: 49 },
  { name: 'Shipping', value: 63 },
  { name: 'Returns', value: 57 },
  { name: 'Billing', value: 71 },
]

/** Weekly totals for the line previews */
export const TICKET_TREND = [
  { week: 'W1', total: 480 },
  { week: 'W2', total: 510 },
  { week: 'W3', total: 495 },
  { week: 'W4', total: 540 },
  { week: 'W5', total: 560 },
  { week: 'W6', total: 585 },
  { week: 'W7', total: 600 },
  { week: 'W8', total: 625 },
]

export const CONTACT_TREND = [
  { week: 'W1', total: 348 },
  { week: 'W2', total: 355 },
  { week: 'W3', total: 362 },
  { week: 'W4', total: 370 },
  { week: 'W5', total: 376 },
  { week: 'W6', total: 384 },
  { week: 'W7', total: 392 },
  { week: 'W8', total: 402 },
]

/** Weekly ticket volume split Email vs Chat (Series = Channel on the line preview) */
export const TICKET_TREND_BY_CHANNEL = [
  { week: 'W1', email: 310, chat: 118 },
  { week: 'W2', email: 325, chat: 124 },
  { week: 'W3', email: 318, chat: 120 },
  { week: 'W4', email: 345, chat: 132 },
  { week: 'W5', email: 355, chat: 138 },
  { week: 'W6', email: 370, chat: 146 },
  { week: 'W7', email: 382, chat: 150 },
  { week: 'W8', email: 402, chat: 148 },
]

export interface RecordRow {
  id: string
  subject: string
  contact: string
  status: string
}

export const RECENT_CONTACTS: RecordRow[] = [
  { id: '#C214', subject: 'Mia Chen', contact: 'Acme Inc', status: 'Customer' },
  { id: '#C213', subject: 'Leo Park', contact: 'Northwind', status: 'Lead' },
  { id: '#C212', subject: 'Ana Souza', contact: 'Globex', status: 'VIP' },
]
