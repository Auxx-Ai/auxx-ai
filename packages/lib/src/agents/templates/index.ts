// packages/lib/src/agents/templates/index.ts

/**
 * Ship-with-the-code agent templates surfaced in the "Create from template"
 * dialog on the agents list page. Each template is a name + description + a
 * single prompt auto-submitted to the new agent's builder chat — same shape
 * as the empty-state `KopilotSuggestion` chips, just chosen up front.
 *
 * Pure data — no tRPC, no DB. Re-exported from `@auxx/lib/agents/client` so
 * the dialog and the docked chat can import them client-side.
 */

export type AgentTemplateCategory = 'support' | 'sales' | 'operations' | 'internal'

export interface AgentTemplate {
  /** Stable kebab-case slug. Used as the URL search param value. */
  id: string
  /**
   * Which agent kind this template produces. The Create dropdown opens the
   * template dialog pre-scoped to a kind and filters by this field. Existing
   * templates are all `'internal'`; chat-kind templates are visitor-facing
   * personas. Orthogonal to `categories` (a topic filter). See plans/chat/v5.
   */
  kind: 'internal' | 'chat'
  /** Display title in the row. */
  name: string
  /** One-line tagline rendered under the name. */
  description: string
  /**
   * The text auto-submitted to the builder chat as the first user turn.
   * Reads like an admin's first ask.
   */
  prompt: string
  /** One or more categories. Drives the sidebar filter. */
  categories: AgentTemplateCategory[]
  /** Lucide icon name (string). Rendered in the row's avatar slot. */
  icon: string
  /** Color id from the EntityIcon palette, e.g. `'sky'`, `'amber'`. */
  color: string
  /** Slug from `BUILDER_AVATAR_POOL` — informational for v1, wired post-MVP. */
  avatarId: string
}

export const agentTemplates: AgentTemplate[] = [
  {
    id: 'support-triage',
    kind: 'internal',
    name: 'Customer support triage',
    description: 'Classify new tickets by urgency and route them to the right team.',
    prompt:
      'Build me a customer support triage agent. When a new email comes in, it should classify urgency, tag the ticket, and assign to the right team based on the subject and body. Use the email and entities toolsets.',
    categories: ['support'],
    icon: 'Headphones',
    color: 'blue',
    avatarId: 'fox',
  },
  {
    id: 'refund-handler',
    kind: 'internal',
    name: 'Refund request handler',
    description: 'Detect refund requests, look up the order, and draft a reply.',
    prompt:
      "Build me a refund request handler. When a customer asks for a refund, look up their most recent Shopify order, check whether it falls inside the refund window, and draft a reply that either confirms the refund or explains why it can't be issued.",
    categories: ['support'],
    icon: 'RefreshCcw',
    color: 'amber',
    avatarId: 'sparkle',
  },
  {
    id: 'vip-escalation',
    kind: 'internal',
    name: 'VIP customer escalation',
    description: 'Spot high-value customers and escalate their tickets immediately.',
    prompt:
      "Build me a VIP escalation agent. When a new ticket arrives, check the contact's lifetime spend in Shopify. If it crosses our VIP threshold, tag the ticket as VIP, bump its priority, and notify the support lead.",
    categories: ['support'],
    icon: 'Crown',
    color: 'purple',
    avatarId: 'owl',
  },
  {
    id: 'sales-lead-qualifier',
    kind: 'internal',
    name: 'Sales lead qualifier',
    description: 'Score inbound leads and hand the hot ones to sales.',
    prompt:
      'Build me a sales lead qualifier. When a new contact comes in through the website form, score the lead based on company size, industry, and message intent. Hot leads get assigned to the sales team; cold ones get a polite nurture reply.',
    categories: ['sales'],
    icon: 'Target',
    color: 'green',
    avatarId: 'rocket',
  },
  {
    id: 'quote-followup',
    kind: 'internal',
    name: 'Quote follow-up reminder',
    description: 'Nudge prospects whose quotes are about to expire.',
    prompt:
      'Build me a quote follow-up agent. Each morning, find quotes that were sent more than three days ago without a reply and draft a short, friendly nudge for the sales rep to review and send.',
    categories: ['sales'],
    icon: 'Send',
    color: 'teal',
    avatarId: 'cat',
  },
  {
    id: 'weekly-metrics-digest',
    kind: 'internal',
    name: 'Weekly metrics digest',
    description: 'Scheduled summary of ticket volume, response time, and trends.',
    prompt:
      'Build me a scheduled agent that runs every Monday morning, pulls last week’s support metrics — ticket volume, average response time, top tags — and posts a digest summary to the team.',
    categories: ['operations'],
    icon: 'BarChart3',
    color: 'indigo',
    avatarId: 'robot',
  },
  {
    id: 'daily-standup',
    kind: 'internal',
    name: 'Daily standup summarizer',
    description: 'Roll up yesterday’s activity into a quick standup post.',
    prompt:
      "Build me a daily standup agent. Each weekday morning, summarize what happened in our team's tickets, threads, and tasks since the previous standup, and post it as a short async standup update.",
    categories: ['internal'],
    icon: 'Sunrise',
    color: 'orange',
    avatarId: 'turtle',
  },
  {
    id: 'onboarding-buddy',
    kind: 'internal',
    name: 'New-hire onboarding buddy',
    description: 'Answer onboarding questions from internal knowledge base.',
    prompt:
      'Build me an onboarding buddy agent. New hires should be able to ask it questions about our processes, tools, and policies, and it should answer from our knowledge base — citing the source doc — and escalate to a human when it isn’t sure.',
    categories: ['internal'],
    icon: 'GraduationCap',
    color: 'pink',
    avatarId: 'dog',
  },

  // ── Chat-kind starters ───────────────────────────────────────────────
  // Visitor-facing personas. Persona-shaped, not toolset-shaped — until the
  // first chat-safe tool lands there's no chat toolset to reference, so
  // escalation/tone guidance is folded inline into the persona prose. The
  // `chat.handoff` tool ships separately; the prompt tells the agent when to
  // reach for it. See plans/chat/v5 phase-2 §2.
  {
    id: 'storefront-support-concierge',
    kind: 'chat',
    name: 'Storefront support concierge',
    description: 'Answers common questions from your knowledge base and hands off when stuck.',
    prompt:
      "Build me a storefront support concierge for our chat widget. It greets visitors warmly, answers their questions using our public knowledge base, and keeps replies short and friendly. If the visitor is frustrated, explicitly asks for a human, or the answer isn't in the knowledge base, it should hand the conversation off to a teammate rather than guess.",
    categories: ['support'],
    icon: 'Headphones',
    color: 'blue',
    avatarId: 'fox',
  },
  {
    id: 'order-status-assistant',
    kind: 'chat',
    name: 'Order status assistant',
    description: 'Helps visitors check “where’s my order?” and escalates edge cases.',
    prompt:
      "Build me an order status assistant for our chat widget. When a visitor asks about their order, it helps them find the status of their own orders only. It never asks for or trusts an order number or email a visitor types to look up someone else's account. If the visitor needs a refund, a change to an order, or anything it can't resolve, it hands off to a human teammate.",
    categories: ['support'],
    icon: 'RefreshCcw',
    color: 'amber',
    avatarId: 'sparkle',
  },
  {
    id: 'presales-product-qa',
    kind: 'chat',
    name: 'Pre-sales product Q&A',
    description: 'Answers product questions for shoppers browsing your store.',
    prompt:
      'Build me a pre-sales product Q&A agent for our chat widget. It answers shoppers’ questions about our products, shipping, and policies using our public knowledge base, and nudges them toward a purchase when it makes sense. Keep the tone helpful and concise. If a shopper asks something the knowledge base doesn’t cover or wants to talk to sales, hand the conversation off to a teammate.',
    categories: ['sales'],
    icon: 'Target',
    color: 'green',
    avatarId: 'rocket',
  },
]
