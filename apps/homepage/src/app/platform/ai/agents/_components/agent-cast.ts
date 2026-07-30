// apps/homepage/src/app/platform/ai/agents/_components/agent-cast.ts

/**
 * The five agents this page casts, and the one place their identity lives.
 *
 * Every section reads from here: the hero list mock, the roster cards, the run
 * illustration's chips and reply avatars, and the eval suite header. Swapping a
 * portrait or an accent colour is a single edit in this file.
 *
 * Accent classes are written out in full because Tailwind cannot see a class
 * name assembled at runtime. Never build one by interpolation.
 */

export type AgentId = 'refund' | 'order-status' | 'invoice-chaser' | 'triage' | 'knowledge'

export interface AgentAccent {
  /** Ring on the active chip and the reply avatar. */
  ring: string
  /** Accent-tinted text, used on trigger chips and the procedure header. */
  text: string
  /** Accent-tinted chip background. */
  chip: string
  /** 2px left rule on the executing procedure line. */
  rule: string
  /** Soft highlight behind the executing procedure line. */
  highlight: string
  /** Blurred circle behind a roster portrait, so the cut-out does not float. */
  wash: string
}

export interface AgentCastMember {
  id: AgentId
  /** Role name. Deliberately not a human first name: these are illustrations. */
  name: string
  /** What starts it, in the product's own trigger vocabulary. */
  trigger: string
  /** Its procedure, or null for the free-form persona case. */
  procedure: string | null
  toolsets: string
  access: string
  /** `Agent.description` — the card's clamped body line. */
  description: string
  /** Model pill on the card footer. */
  model: string
  /** `LastUpdated` subtitle on the card. */
  updated: string
  /** `chat` agents get the Chat badge and sit in the Chat agents section. */
  kind: 'chat' | 'internal'
  src: string
  alt: string
  /**
   * `object-position` for the circular crop. The sources are 666x1024 waist-up
   * portraits and the heads do not sit at identical heights, so each one gets
   * its own value rather than sharing a single guess.
   */
  headOffset: string
  accent: AgentAccent
}

const PURPLE: AgentAccent = {
  ring: 'ring-purple-500/50',
  text: 'text-purple-600 dark:text-purple-400',
  chip: 'bg-purple-500/10 text-purple-700 dark:text-purple-300',
  rule: 'bg-purple-500',
  highlight: 'bg-purple-500/[0.06]',
  wash: 'bg-purple-500/20 dark:bg-purple-500/10',
}

const BLUE: AgentAccent = {
  ring: 'ring-blue-500/50',
  text: 'text-blue-600 dark:text-blue-400',
  chip: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
  rule: 'bg-blue-500',
  highlight: 'bg-blue-500/[0.06]',
  wash: 'bg-blue-500/20 dark:bg-blue-500/10',
}

const ORANGE: AgentAccent = {
  ring: 'ring-orange-500/50',
  text: 'text-orange-600 dark:text-orange-400',
  chip: 'bg-orange-500/10 text-orange-700 dark:text-orange-300',
  rule: 'bg-orange-500',
  highlight: 'bg-orange-500/[0.06]',
  wash: 'bg-orange-500/20 dark:bg-orange-500/10',
}

const GREEN: AgentAccent = {
  ring: 'ring-emerald-500/50',
  text: 'text-emerald-600 dark:text-emerald-400',
  chip: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  rule: 'bg-emerald-500',
  highlight: 'bg-emerald-500/[0.06]',
  wash: 'bg-emerald-500/20 dark:bg-emerald-500/10',
}

const PINK: AgentAccent = {
  ring: 'ring-pink-500/50',
  text: 'text-pink-600 dark:text-pink-400',
  chip: 'bg-pink-500/10 text-pink-700 dark:text-pink-300',
  rule: 'bg-pink-500',
  highlight: 'bg-pink-500/[0.06]',
  wash: 'bg-pink-500/20 dark:bg-pink-500/10',
}

export const AGENT_CAST: AgentCastMember[] = [
  {
    id: 'refund',
    name: 'Refund handler',
    trigger: 'Customer message',
    procedure: 'Refund requests',
    toolsets: '4 toolsets · 11 tools',
    access: 'Support profile · Edit on Tickets',
    description: 'Handles return and refund requests end to end, inside the policy window.',
    model: 'claude-sonnet-5',
    updated: '2 hours ago',
    kind: 'chat',
    src: '/images/ai-headshots/agent-purple-female-1.png',
    alt: 'Refund handler agent',
    headOffset: '50% 6%',
    accent: PURPLE,
  },
  {
    id: 'order-status',
    name: 'Order status',
    trigger: 'Customer message',
    procedure: "Where's my order",
    toolsets: '3 toolsets · 7 tools',
    access: 'Support profile · Read on Orders',
    description: 'Answers where-is-my-order questions and escalates anything late or damaged.',
    model: 'claude-sonnet-5',
    updated: '5 hours ago',
    kind: 'chat',
    src: '/images/ai-headshots/agent-blue-female.png',
    alt: 'Order status agent',
    headOffset: '50% 7%',
    accent: BLUE,
  },
  {
    id: 'invoice-chaser',
    name: 'Invoice chaser',
    trigger: 'Schedule · 08:00 daily',
    procedure: 'Overdue invoices',
    toolsets: '3 toolsets · 9 tools',
    access: 'Billing profile · Edit on Invoices',
    description: 'Chases overdue invoices every morning and flags the ones that need a human.',
    model: 'claude-haiku-4-5',
    updated: 'yesterday',
    kind: 'internal',
    src: '/images/ai-headshots/agent-orange-male.png',
    alt: 'Invoice chaser agent',
    headOffset: '50% 5%',
    accent: ORANGE,
  },
  {
    id: 'triage',
    name: 'Ticket triage',
    trigger: 'Event · Ticket created',
    procedure: 'Triage & route',
    toolsets: '4 toolsets · 10 tools',
    access: 'Support profile · Edit on Tickets',
    description: 'Reads every new ticket, sets priority, and routes it to the right group.',
    model: 'claude-haiku-4-5',
    updated: '3 days ago',
    kind: 'internal',
    src: '/images/ai-headshots/agent-green-male.png',
    alt: 'Ticket triage agent',
    headOffset: '50% 5%',
    accent: GREEN,
  },
  {
    id: 'knowledge',
    name: 'Knowledge keeper',
    trigger: '@mention in a comment',
    procedure: null,
    toolsets: '2 toolsets · 5 tools',
    access: 'Read-only everywhere',
    description: 'Answers product questions from the knowledge base when someone @mentions it.',
    model: 'claude-sonnet-5',
    updated: '6 days ago',
    kind: 'internal',
    src: '/images/ai-headshots/agent-pink-female.png',
    alt: 'Knowledge keeper agent',
    headOffset: '50% 8%',
    accent: PINK,
  },
]

/** Lookup by id. Throws at module scope if an id is ever mistyped in a script. */
export function agentById(id: AgentId): AgentCastMember {
  const found = AGENT_CAST.find((a) => a.id === id)
  if (!found) throw new Error(`Unknown agent id: ${id}`)
  return found
}
