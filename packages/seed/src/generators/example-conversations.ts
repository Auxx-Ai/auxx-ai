// packages/seed/src/generators/example-conversations.ts
// Scripted, realistic Shopify order-support conversations. Seeded into new real
// accounts (the `example` scenario), reused by the `demo` scenario to fill its
// first threads with believable content, and injected standalone into existing
// orgs via the `shopify-review` scenario for Shopify app-review demos. Each
// conversation renders as one thread with 3-4 alternating customer/agent
// messages. Subjects are stored WITHOUT any branding prefix — callers that want
// the `[Example] ` prefix (only the `example` scenario) apply it at generation
// time, in `CommunicationDomain`.

/** ExampleConversation describes a single thread's scripted content. */
export interface ExampleConversation {
  /** subject is the thread subject, unprefixed. */
  subject: string
  /** messages alternate between customer (inbound) and agent (outbound). */
  messages: Array<{ from: 'customer' | 'agent'; body: string }>
}

/** ExamplePersona identifies the customer behind a scripted conversation, so
 * seeded contacts/participants can match the signature in the message body. */
export interface ExamplePersona {
  /** name is the customer's display name (matches the message sign-off). */
  name: string
  /** email is the customer's seeded contact email. */
  email: string
}

/**
 * personas is index-aligned with EXAMPLE_CONVERSATIONS — `personas[i]` is the
 * customer on `EXAMPLE_CONVERSATIONS[i]`.
 */
export const personas: ExamplePersona[] = [
  { name: 'Jordan Lee', email: 'jordan.lee@gmail.com' },
  { name: 'Priya Nair', email: 'priya.nair@outlook.com' },
  { name: 'Devon Brooks', email: 'devon.brooks@yahoo.com' },
  { name: 'Riley Morgan', email: 'riley.morgan@icloud.com' },
  { name: 'Taylor Reed', email: 'taylor.reed@gmail.com' },
  { name: 'Avery Chen', email: 'avery.chen@hotmail.com' },
  { name: 'Casey Kim', email: 'casey.kim@gmail.com' },
  { name: 'Noor Ahmed', email: 'noor.ahmed@outlook.com' },
]

/**
 * EXAMPLE_CONVERSATIONS renders to 8 Shopify order-support threads (28 messages
 * total), index-aligned with `personas`. Order numbers follow dev-store style
 * (`#1001`-`#1042`, sequential, no letter prefix) so the reply workflow's order
 * lookup queries something a real Shopify test store could contain. Four of the
 * eight end on an unanswered customer message — an open question the AI-reply
 * workflow can plausibly act on; the rest keep a resolved back-and-forth shape.
 */
export const EXAMPLE_CONVERSATIONS: ExampleConversation[] = [
  {
    // Resolved — ends on an agent message.
    subject: "Where's my order #1001?",
    messages: [
      {
        from: 'customer',
        body: `Hi, I placed order #1001 last Monday and the tracking page still just says "Label created" — no movement in three days. Can you check what's going on?\n\nThanks,\nJordan`,
      },
      {
        from: 'agent',
        body: `Hi Jordan,\n\nThanks for flagging this — I checked #1001 and the good news is it actually left our warehouse yesterday afternoon; the carrier's scan just hadn't caught up with the tracking page yet. It's now showing in transit with an estimated delivery of this Thursday.\n\nI'll keep watching it and reach out if that changes.\n\nBest,\nSam`,
      },
      {
        from: 'customer',
        body: `That's a relief, thank you for checking so quickly!`,
      },
      {
        from: 'agent',
        body: `Anytime — you're all set. Reply here if Thursday comes and goes without it.\n\n— Sam`,
      },
    ],
  },
  {
    // Open — ends on an unanswered customer question.
    subject: 'Order #1012 — wrong size, exchange request',
    messages: [
      {
        from: 'customer',
        body: `Hello,\n\nI ordered the Aria dress in a medium last week (order #1012) but it's noticeably too snug. Could I exchange it for a large instead? Everything's unworn with tags still on.\n\nThanks,\nPriya`,
      },
      {
        from: 'agent',
        body: `Hi Priya,\n\nOf course — happy to get that swapped out. Before I send a return label, can you confirm the color/style code on the tag (should start with ARIA-)? We're low on stock in a couple of the large sizes and I want to reserve the right one for you before it sells out.\n\nBest,\nMorgan`,
      },
      {
        from: 'customer',
        body: `It's ARIA-BLK-M on the tag — hoping the black is still in stock in a large! Let me know if I should just go ahead and place a new order instead so I'm not stuck waiting.`,
      },
    ],
  },
  {
    // Resolved — ends on an agent message.
    subject: 'Refund status for returned order #1005',
    messages: [
      {
        from: 'customer',
        body: `Hi,\n\nI returned order #1005 on the 12th and the carrier confirmed delivery to your warehouse last Friday. I still haven't seen a refund hit my card — could you check on this?\n\nThanks,\nDevon`,
      },
      {
        from: 'agent',
        body: `Hi Devon,\n\nThanks for the nudge. I can see the return was received and inspected yesterday, and the refund was issued to your original payment method this morning. Banks usually take 3–5 business days to post it, so it should show on your statement by the end of the week.\n\nIf it's still not there by Monday, reply here and I'll pull the transaction ID for you.\n\nBest,\nAlex`,
      },
      {
        from: 'customer',
        body: `Perfect, appreciate the quick update — I'll keep an eye on my statement.`,
      },
      {
        from: 'agent',
        body: `Sounds good. Talk soon if it doesn't show up!\n\n— Alex`,
      },
    ],
  },
  {
    // Open — ends on an unanswered customer question.
    subject: 'Change shipping address on order #1023',
    messages: [
      {
        from: 'customer',
        body: `Hi support,\n\nI just placed order #1023 a few minutes ago but realized I typed my old apartment number. Is it too late to change the shipping address to 482 Pine St., Apt 7B instead of 3A? Everything else on the order is correct.\n\nThanks!\nRiley`,
      },
      {
        from: 'agent',
        body: `Hi Riley,\n\nGood catch — orders sit in the queue for about 30 minutes before they're picked, so there's still time. Can you confirm the order is under the same email you're messaging from, and that the zip code stays 98104? I want to make sure I'm updating the right one before it locks in.\n\nBest,\nJordan`,
      },
      {
        from: 'customer',
        body: `Yes, same email, and the zip is still 98104 — just the apartment number needs fixing. Can you confirm once it's updated?`,
      },
    ],
  },
  {
    // Open — ends on an unanswered customer question.
    subject: 'Order #1017 arrived damaged — replacement request',
    messages: [
      {
        from: 'customer',
        body: `Hello,\n\nMy order #1017 arrived today and the ceramic mug inside was shattered — looks like the box took a hit in transit. I've attached photos of the damage and the packaging.\n\nWhat's the best way to get a replacement?\n\nThanks,\nTaylor`,
      },
      {
        from: 'agent',
        body: `Hi Taylor,\n\nSo sorry about that — thanks for sending the photos, that's exactly what I needed. I can get a free replacement on its way today, but first: do you want the exact same mug reshipped, or would you rather swap for a different color while we're at it? No charge either way.\n\nBest,\nCasey`,
      },
      {
        from: 'customer',
        body: `Let's do the same one again, please — just want it in one piece this time! Could you make sure it's packed a bit more securely as well?`,
      },
    ],
  },
  {
    // Resolved — ends on an agent message.
    subject: 'Charged twice for order #1009',
    messages: [
      {
        from: 'customer',
        body: `Hi,\n\nI'm looking at my card statement and it shows two charges of $89.00 from you on the same day, but I only placed one order (#1009). Can you confirm whether one is a pending authorization that'll drop off, or do I need a refund?\n\nThanks,\nAvery`,
      },
      {
        from: 'agent',
        body: `Hi Avery,\n\nThanks for flagging that. I pulled up #1009 — the second charge is a pending authorization that was placed when your card initially declined and then went through on retry. It should fall off your statement automatically within 3 business days; no action needed on your end, and only one charge will ultimately settle.\n\nIf it's still sitting there by Friday, reply back and I'll escalate to our payment processor directly.\n\nBest,\nPat`,
      },
      {
        from: 'customer',
        body: `Got it, thanks for clarifying — I'll keep an eye on it.`,
      },
      {
        from: 'agent',
        body: `Anytime. Reach out if Friday comes and it's still doubled up.\n\n— Pat`,
      },
    ],
  },
  {
    // Open — ends on an unanswered customer question.
    subject: 'Cancel order #1031 before it ships',
    messages: [
      {
        from: 'customer',
        body: `Hi,\n\nI need to cancel order #1031 if it hasn't shipped yet — I accidentally ordered the wrong color. Please let me know if I'm in time.\n\nThanks,\nCasey`,
      },
      {
        from: 'agent',
        body: `Hi Casey,\n\nI checked #1031 and it's still in our pick queue, so there's a good chance we can catch it — but our warehouse does a cutoff run in the next hour. Can you confirm you'd like a full cancellation rather than an exchange for the correct color? I can move faster if I know which one to process.\n\nBest,\nRiley`,
      },
      {
        from: 'customer',
        body: `A full cancellation is fine, I'll just reorder the right color separately. Please confirm as soon as it's stopped!`,
      },
    ],
  },
  {
    // Resolved — ends on an agent message.
    subject: "Discount code didn't apply on order #1027",
    messages: [
      {
        from: 'customer',
        body: `Hello,\n\nI used the code WELCOME15 at checkout on order #1027 but the total charged doesn't reflect the 15% discount. Can you check what happened?\n\nThanks,\nNoor`,
      },
      {
        from: 'agent',
        body: `Hi Noor,\n\nThanks for catching that — looking at #1027, the code was entered correctly but had expired the day before your order (it was a launch-week promo). Since this was a first-purchase mix-up, I've gone ahead and manually applied the 15% as a refund to your original payment method — you should see $13.35 back within a few business days.\n\nBest,\nRowan`,
      },
      {
        from: 'customer',
        body: `That's really kind of you, thank you for sorting it out!`,
      },
      {
        from: 'agent',
        body: `Happy to help — welcome aboard, and enjoy the order!\n\n— Rowan`,
      },
    ],
  },
]
