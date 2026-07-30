// apps/homepage/src/app/platform/ai/agents/_components/agent-scripts.ts

import type { AgentId } from './agent-cast'

/**
 * The four procedure runs, written as data so the illustration is a renderer.
 *
 * The shape follows what actually happens at run time: an agent has a persona
 * and a list of attached procedures; a message arrives; `selectProcedure` picks
 * ONE of them (sticky resume → ruleset prefilter → a single classifier call over
 * `whenToUse`); that procedure opens and the stepper walks it. The left column
 * therefore starts as persona + procedure list, not as an already-open document.
 *
 * A procedure is an authored *document*: prose carrying inline badges plus
 * IF / ELSE condition arms. That is what `ProcedureLine` models.
 *
 * Every tool name below is a real registered name from
 * `packages/lib/src/ai/kopilot/capabilities/`.
 */

/** An inline run of a procedure paragraph. */
export type Segment =
  | { t: 'text'; v: string }
  /** `@[tool:…]` mention chip. Gray, like any other reference. */
  | { t: 'tool'; v: string }
  /** A field or record reference chip. */
  | { t: 'ref'; v: string }
  /** `code:<id>` badge. Indigo, its own deterministic step. */
  | { t: 'code'; v: string }
  /** `subprocedure:<id>` badge. Forest, drills into a named body. */
  | { t: 'subprocedure'; v: string }
  /** `route:<outcome>` badge. Red, terminal. */
  | { t: 'route'; v: 'finished' | 'handoff' }

export interface ProcedureLine {
  id: string
  segments: Segment[]
  /** Renders the `If` / `Else` arm keyword ahead of the prose. */
  arm?: 'if' | 'else'
  /** Sits inside the arm above it. */
  indent?: boolean
}

/** One row of the agent's Procedures section (`AgentProcedure` link). */
export interface ProcedureLink {
  id: string
  name: string
  /** The selection criteria the classifier reads. */
  whenToUse: string
  /** Only the opened one carries a body; the rest are list rows. */
  lines?: ProcedureLine[]
}

type RunEntryBody =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; name: string; detail: string }
  | { kind: 'signal'; name: string }
  | { kind: 'select'; procedureId: string; note: string }
  | { kind: 'branch'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'approval'; text: string }
  | { kind: 'note'; text: string }
  | { kind: 'system'; text: string }
  | { kind: 'terminal'; text: string; tone: 'finished' | 'handoff' }

export type RunEntry = RunEntryBody & {
  /**
   * Which procedure line is executing while this entry appears. Absent before a
   * procedure is selected — the left column is still showing the list then.
   */
  line?: string
  /** Overrides the default step duration, in ms. */
  dwell?: number
}

export interface AgentScript {
  agentId: AgentId
  /** Short excerpt of the authored persona, shown above the procedure list. */
  persona: string
  /** Everything attached to this agent. Exactly one carries `lines`. */
  procedures: ProcedureLink[]
  /** The one this run opens. */
  selectedId: string
  version: string
  run: RunEntry[]
  /** Rendered under the illustration while this agent is active. */
  caption?: { text: string; href: string; linkLabel: string }
}

const text = (v: string): Segment => ({ t: 'text', v })
const tool = (v: string): Segment => ({ t: 'tool', v })
const ref = (v: string): Segment => ({ t: 'ref', v })
const code = (v: string): Segment => ({ t: 'code', v })

export const AGENT_SCRIPTS: AgentScript[] = [
  {
    agentId: 'refund',
    persona:
      'You handle returns and refunds for Alder Supply. Be warm and brief. Never promise money back before you have checked the delivery date.',
    selectedId: 'refund-requests',
    version: 'v4',
    procedures: [
      {
        id: 'refund-requests',
        name: 'Refund requests',
        whenToUse: 'The customer wants money back on something they already received.',
        lines: [
          {
            id: 'confirm',
            segments: [
              text('Confirm which order and item the customer means.'),
              tool('get_entity'),
              tool('search_entities'),
            ],
          },
          {
            id: 'if',
            arm: 'if',
            segments: [
              text('delivered within'),
              ref('30 days'),
              text('and not a'),
              ref('final sale'),
            ],
          },
          {
            id: 'refund',
            indent: true,
            segments: [text('Issue the refund.'), tool('update_entity'), tool('reply_to_thread')],
          },
          { id: 'else', arm: 'else', segments: [] },
          {
            id: 'explain',
            indent: true,
            segments: [
              text('Explain the window and offer store credit.'),
              tool('search_knowledge'),
            ],
          },
          { id: 'end', segments: [{ t: 'route', v: 'finished' }] },
        ],
      },
      {
        id: 'damaged',
        name: 'Damaged on arrival',
        whenToUse: 'The item arrived broken, or the wrong item shipped.',
      },
      {
        id: 'label',
        name: 'Return label reissue',
        whenToUse: 'The customer lost the return label or it has expired.',
      },
    ],
    run: [
      { kind: 'user', text: 'I want to return the boots I ordered.' },
      {
        kind: 'select',
        procedureId: 'refund-requests',
        note: 'One classifier call over the three whenToUse lines.',
        dwell: 2000,
      },
      { line: 'confirm', kind: 'tool', name: 'get_entity', detail: 'Order #4521' },
      {
        line: 'confirm',
        kind: 'assistant',
        text: "That's order #4521, the Alder boots, delivered Jul 12.",
      },
      { line: 'confirm', kind: 'signal', name: 'advance_procedure' },
      { line: 'if', kind: 'branch', text: 'If → within 30 days · true' },
      { line: 'refund', kind: 'user', text: "Wait, where's my other order?" },
      { line: 'refund', kind: 'signal', name: 'digress' },
      {
        line: 'refund',
        kind: 'note',
        text: 'Answered, without losing the thread. The procedure is still on this step.',
        dwell: 2300,
      },
      { line: 'refund', kind: 'approval', text: 'Approval needed · refund $189.00' },
      { line: 'refund', kind: 'tool', name: 'update_entity', detail: 'Status → Refunded' },
      { line: 'end', kind: 'terminal', text: 'End procedure', tone: 'finished' },
    ],
  },

  {
    agentId: 'order-status',
    persona:
      'You answer questions about orders in flight. Give a real date, never a range. If the carrier is running late, say so plainly and hand off.',
    selectedId: 'wheres-my-order',
    version: 'v2',
    procedures: [
      {
        id: 'wheres-my-order',
        name: "Where's my order",
        whenToUse: 'The customer is asking where an order that has already shipped is.',
        lines: [
          {
            id: 'find',
            segments: [
              text('Find the order the customer is asking about.'),
              tool('search_entities'),
              tool('get_entity'),
            ],
          },
          { id: 'days', segments: [code('Days late')] },
          { id: 'if', arm: 'if', segments: [ref('days late'), text('is more than 5')] },
          { id: 'handoff', indent: true, segments: [{ t: 'route', v: 'handoff' }] },
          { id: 'else', arm: 'else', segments: [] },
          {
            id: 'tracking',
            indent: true,
            segments: [text('Share the tracking link.'), tool('reply_to_thread')],
          },
        ],
      },
      {
        id: 'address',
        name: 'Change delivery address',
        whenToUse: 'The customer wants the parcel sent somewhere else before it arrives.',
      },
    ],
    run: [
      { kind: 'user', text: "My order still hasn't arrived." },
      {
        kind: 'select',
        procedureId: 'wheres-my-order',
        note: 'Two candidates, one classifier call.',
        dwell: 1800,
      },
      { line: 'find', kind: 'tool', name: 'search_entities', detail: 'Order #4390' },
      { line: 'find', kind: 'tool', name: 'get_entity', detail: 'ETA was Jul 21' },
      { line: 'find', kind: 'signal', name: 'advance_procedure' },
      { line: 'days', kind: 'code', text: 'Days late → 7' },
      {
        line: 'days',
        kind: 'note',
        text: 'Deterministic. The stepper walks through it and never rests here.',
        dwell: 2100,
      },
      { line: 'if', kind: 'branch', text: 'If → more than 5 · true' },
      { line: 'handoff', kind: 'terminal', text: 'Hand off to human', tone: 'handoff' },
      { line: 'handoff', kind: 'system', text: 'Assigned to Maya · agent stopped' },
    ],
  },

  {
    agentId: 'invoice-chaser',
    persona:
      'You chase invoices that are past due. Firm, never rude, one reminder per thread. Always link the invoice itself.',
    selectedId: 'overdue-invoices',
    version: 'v3',
    procedures: [
      {
        id: 'overdue-invoices',
        name: 'Overdue invoices',
        whenToUse: 'Runs every morning across every invoice past its due date.',
        lines: [
          { id: 'load', segments: [code('Overdue invoices')] },
          {
            id: 'remind',
            segments: [
              text("For each invoice, write a short reminder in the customer's own thread."),
              tool('reply_to_thread'),
            ],
          },
          { id: 'if', arm: 'if', segments: [text("it's more than 30 days overdue")] },
          {
            id: 'flag',
            indent: true,
            segments: [
              text('Flag it for the account owner.'),
              tool('create_task'),
              tool('update_entity'),
            ],
          },
          { id: 'end', segments: [{ t: 'route', v: 'finished' }] },
        ],
      },
      {
        id: 'payment-failed',
        name: 'Payment failed',
        whenToUse: 'A card was declined and the invoice is still open.',
      },
    ],
    run: [
      { kind: 'system', text: 'Schedule fired · 08:00' },
      {
        kind: 'select',
        procedureId: 'overdue-invoices',
        note: 'A scheduled trigger names its procedure. No classifier call at all.',
        dwell: 2200,
      },
      { line: 'load', kind: 'code', text: 'Overdue invoices → 14' },
      { line: 'remind', kind: 'tool', name: 'reply_to_thread', detail: '14 threads' },
      { line: 'remind', kind: 'signal', name: 'advance_procedure' },
      { line: 'if', kind: 'branch', text: 'If → over 30 days · 3 of 14' },
      { line: 'flag', kind: 'tool', name: 'create_task', detail: '3 account owners' },
      { line: 'flag', kind: 'tool', name: 'update_entity', detail: 'Status → Escalated ×3' },
      {
        line: 'end',
        kind: 'terminal',
        text: 'End procedure · no customer in the loop',
        tone: 'finished',
      },
    ],
    caption: {
      text: "A sequence sends three invoice reminders on a timer, and it's cheaper for that. An agent is for the ones that need a decision.",
      href: '/platform/sequences',
      linkLabel: 'See Sequences',
    },
  },

  {
    agentId: 'triage',
    persona:
      'You read every new ticket and route it. You never answer the customer yourself, and you never guess a group you are unsure about.',
    selectedId: 'triage-route',
    version: 'v6',
    procedures: [
      {
        id: 'triage-route',
        name: 'Triage & route',
        whenToUse: 'Every newly created ticket, before a human sees it.',
        lines: [
          {
            id: 'read',
            segments: [
              text("Read the ticket and decide what it's about."),
              tool('get_entity'),
              tool('search_knowledge'),
            ],
          },
          { id: 'route', segments: [code('Route to group')] },
          {
            id: 'set',
            segments: [
              text('Set the priority, tag it, and assign the owner.'),
              tool('update_entity'),
              tool('create_note'),
            ],
          },
          { id: 'end', segments: [{ t: 'route', v: 'finished' }] },
        ],
      },
      {
        id: 'duplicate',
        name: 'Duplicate detection',
        whenToUse: 'The same customer opened a second ticket about the same thing.',
      },
      {
        id: 'vip',
        name: 'VIP fast lane',
        whenToUse: 'The contact is on an enterprise plan and the ticket looks urgent.',
      },
    ],
    run: [
      { kind: 'system', text: 'Ticket #8812 created' },
      {
        kind: 'select',
        procedureId: 'triage-route',
        note: 'Ruleset prefilter dropped VIP fast lane before the classifier ran.',
        dwell: 2200,
      },
      { line: 'read', kind: 'tool', name: 'get_entity', detail: 'Ticket #8812' },
      { line: 'read', kind: 'tool', name: 'search_knowledge', detail: '2 articles' },
      { line: 'read', kind: 'signal', name: 'advance_procedure' },
      { line: 'route', kind: 'code', text: 'Route to group → Billing' },
      {
        line: 'set',
        kind: 'tool',
        name: 'update_entity',
        detail: 'Priority → High, Group → Billing',
      },
      { line: 'set', kind: 'tool', name: 'create_note', detail: 'triage rationale' },
      { line: 'end', kind: 'terminal', text: 'End procedure · 0.9s', tone: 'finished' },
    ],
  },
]
