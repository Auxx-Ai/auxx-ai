// packages/seed/src/generators/example-conversations.ts
// Scripted, realistic conversations seeded into new real accounts so the inbox
// doesn't feel empty on first load. Each conversation renders as one thread with
// 3–4 alternating customer/agent messages.

/** ExampleConversation describes a single thread's scripted content. */
export interface ExampleConversation {
  /** subject is the thread subject (already prefixed with `[Example] `). */
  subject: string
  /** messages alternate between customer (inbound) and agent (outbound). */
  messages: Array<{ from: 'customer' | 'agent'; body: string }>
}

/** EXAMPLE_CONVERSATIONS renders to 8 threads with ~28 messages total. */
export const EXAMPLE_CONVERSATIONS: ExampleConversation[] = [
  {
    subject: "[Example] Where's my order #A-10432?",
    messages: [
      {
        from: 'customer',
        body: `Hi there,\n\nI placed order #A-10432 on Tuesday and the tracking page says it's still "in transit" but hasn't updated in four days. Could you check on the status and let me know when I should expect it?\n\nThanks,\nJamie`,
      },
      {
        from: 'agent',
        body: `Hi Jamie,\n\nThanks for reaching out. I looked up order #A-10432 — it left our warehouse on Tuesday evening and is currently with the carrier. The stall in tracking updates usually means it's sitting at a regional sort facility; I'm seeing an estimated delivery of this Friday.\n\nI'll keep an eye on it, and if it hasn't moved by tomorrow I'll open a trace with the carrier.\n\nBest,\nSam`,
      },
      {
        from: 'customer',
        body: `That works, thanks for checking! Please let me know if anything changes before Friday.`,
      },
      {
        from: 'agent',
        body: `Will do. I've set a reminder on our end and you'll hear from me either way.\n\n— Sam`,
      },
    ],
  },
  {
    subject: '[Example] Wrong size — need to exchange',
    messages: [
      {
        from: 'customer',
        body: `Hello,\n\nI ordered the charcoal hoodie in a medium last week (order #A-10388) but it's running small on me. Is it possible to exchange it for a large? I haven't worn it — tags are still on.\n\nThanks!\nPriya`,
      },
      {
        from: 'agent',
        body: `Hi Priya,\n\nAbsolutely, happy to swap that out for you. I'm sending over a prepaid return label now — just drop the medium back in the original packaging and pop it in any mailbox.\n\nI've also reserved a large in charcoal under your account; as soon as we scan the return, it'll ship out the same day.\n\nBest,\nMorgan`,
      },
      {
        from: 'customer',
        body: `Amazing, thank you! I'll drop it off tomorrow morning.`,
      },
    ],
  },
  {
    subject: '[Example] Refund status check',
    messages: [
      {
        from: 'customer',
        body: `Hi,\n\nI returned order #A-10211 on the 12th and UPS confirmed delivery to your warehouse last Friday. I still haven't seen the refund on my card — can you check on this?\n\nThanks,\nDevon`,
      },
      {
        from: 'agent',
        body: `Hi Devon,\n\nThanks for the nudge. I see the return was received and inspected yesterday, and the refund was issued to your original payment method this morning. Banks typically take 3–5 business days to post it, so you should see it on your statement by the end of the week.\n\nIf it hasn't shown up by Monday, reply here and I'll dig into the transaction ID.\n\nBest,\nAlex`,
      },
      {
        from: 'customer',
        body: `Perfect, appreciate the quick update.`,
      },
    ],
  },
  {
    subject: '[Example] Can I change my shipping address?',
    messages: [
      {
        from: 'customer',
        body: `Hi support,\n\nI just placed order #A-10501 but realized I typed my old apartment number in the shipping address. Is it too late to change it to 482 Pine St., Apt 7B instead of 3A? The rest of the address is correct.\n\nThanks!\nRiley`,
      },
      {
        from: 'agent',
        body: `Hi Riley,\n\nGood catch — I was able to update the shipping address on #A-10501 to 482 Pine St., Apt 7B before it hit the pick queue. The order should ship out tomorrow to the new address, and you'll get an updated confirmation email shortly.\n\nLet me know if anything else looks off.\n\nBest,\nJordan`,
      },
      {
        from: 'customer',
        body: `You're a lifesaver, thanks!`,
      },
    ],
  },
  {
    subject: '[Example] Damaged item — photos attached',
    messages: [
      {
        from: 'customer',
        body: `Hello,\n\nMy order #A-10344 arrived today and the ceramic mug inside was shattered — looks like the box took a hit in transit. I've attached a couple of photos of the damage and the packaging.\n\nWhat's the best way to get a replacement?\n\nThanks,\nTaylor`,
      },
      {
        from: 'agent',
        body: `Hi Taylor,\n\nSo sorry about that — a broken mug is the last thing anyone wants to unbox. Thanks for sending the photos; that's all I needed on our end.\n\nI've put a replacement on the way at no charge (order #A-10502), and you don't need to send the broken one back. You should see tracking within the hour.\n\nBest,\nCasey`,
      },
      {
        from: 'customer',
        body: `Wow, that was fast. Thanks so much!`,
      },
      {
        from: 'agent',
        body: `Happy to help! Enjoy the (intact) mug.\n\n— Casey`,
      },
    ],
  },
  {
    subject: '[Example] Duplicate charge on last invoice',
    messages: [
      {
        from: 'customer',
        body: `Hi,\n\nI'm looking at my card statement and it shows two charges for $89.00 from you on the same day — I only placed one order (#A-10422). Can you confirm whether one of those is a pending auth that will drop off, or do I need a refund?\n\nThanks,\nAvery`,
      },
      {
        from: 'agent',
        body: `Hi Avery,\n\nThanks for flagging that. I pulled up #A-10422 — the second charge is a pending authorization that was placed when your card initially declined and then succeeded on retry. It should fall off your statement automatically within 3 business days; no action needed on your end, and only one charge will ultimately settle.\n\nIf it's still sitting there on Friday, reply back and I'll reach out to our payment processor directly.\n\nBest,\nPat`,
      },
      {
        from: 'customer',
        body: `Got it, thanks for clarifying. I'll keep an eye on it.`,
      },
    ],
  },
  {
    subject: '[Example] How do I cancel my subscription?',
    messages: [
      {
        from: 'customer',
        body: `Hi,\n\nI'd like to cancel my monthly subscription for the coffee beans (subscription ID SUB-4412). Not because of any issue — just trying to cut down on recurring charges for a bit. What's the best way to handle this?\n\nThanks,\nLee`,
      },
      {
        from: 'agent',
        body: `Hi Lee,\n\nTotally understand — I went ahead and cancelled SUB-4412 for you. You won't be charged for any future deliveries, and your most recent shipment (already on its way) is still yours to keep.\n\nIf you change your mind, just reply here and I can reinstate it at the same price tier. No pressure either way.\n\nBest,\nQuinn`,
      },
      {
        from: 'customer',
        body: `Appreciate you making that painless. Might be back in a few months!`,
      },
    ],
  },
  {
    subject: '[Example] Product question before I buy',
    messages: [
      {
        from: 'customer',
        body: `Hello,\n\nQuick question before I check out — does the leather tote (SKU TOTE-221) fit a 15" laptop? I can't tell from the dimensions on the product page. Also, is the interior lined?\n\nThanks!\nNoor`,
      },
      {
        from: 'agent',
        body: `Hi Noor,\n\nGreat question — yes, the TOTE-221 comfortably fits a 15" laptop (most 16" laptops squeeze in too, though it's snug). The interior is lined with a natural canvas and has one zippered pocket plus two open slip pockets.\n\nLet me know if you'd like me to send over any additional photos of the inside.\n\nBest,\nRowan`,
      },
      {
        from: 'customer',
        body: `Perfect, that's exactly what I needed. Placing my order now!`,
      },
      {
        from: 'agent',
        body: `Awesome — enjoy, and reply here any time if anything comes up.\n\n— Rowan`,
      },
    ],
  },
]
