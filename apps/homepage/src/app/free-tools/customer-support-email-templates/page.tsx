// apps/homepage/src/app/free-tools/customer-support-email-templates/page.tsx

import { getHomepageUrl } from '@auxx/config/client'
import type { Metadata } from 'next'
import Link from 'next/link'
import { LeadCaptureForm } from '../_components/lead-capture-form'
import { TemplateBlock } from '../_components/template-block'
import { ToolLayout } from '../_components/tool-layout'

const TOOL_SLUG = 'customer-support-email-templates'
const CANONICAL = getHomepageUrl(`/free-tools/${TOOL_SLUG}`)

export const metadata: Metadata = {
  title: '15 Free Customer Support Email Templates (Copy-Paste) | Auxx.ai',
  description:
    '15 customer support email templates for small businesses — order updates, refunds, shipping delays, angry customers, and more. Free copy-paste templates, no signup required.',
  alternates: { canonical: CANONICAL },
  openGraph: {
    title: '15 Free Customer Support Email Templates',
    description: 'Copy-paste support email templates for small businesses.',
    url: CANONICAL,
    type: 'website',
  },
}

type Template = {
  title: string
  useWhen: string
  body: string
  whyItWorks?: string
}

const orderTemplates: Template[] = [
  {
    title: 'Order confirmation',
    useWhen: 'a customer has just completed checkout',
    body: `Hi {{customer_first_name}},

Thanks for your order. Here is what we are sending you:

Order #{{order_number}}
{{line_items}}

We will email you again the moment your order ships, with a tracking link. If anything looks wrong, reply to this email — it goes straight to a human.

{{your_name}}`,
    whyItWorks:
      'Opens with a thank-you, shows the order, promises the next touchpoint, and offers a real reply path.',
  },
  {
    title: 'Shipping delay notification',
    useWhen: 'an order is running behind the promised ship date',
    body: `Hi {{customer_first_name}},

Quick update on order #{{order_number}}: it is going to ship {{new_eta}} instead of the original date. The reason is {{brief_cause}}.

Tracking will go out the moment it leaves the warehouse. If the new date does not work for you, reply to this email and I will sort out a refund or an alternative.

Sorry for the bump,
{{your_name}}`,
    whyItWorks:
      'Specific new date, one-line cause, clear opt-out — no "we apologize for any inconvenience".',
  },
  {
    title: 'Out-of-stock apology with alternative',
    useWhen: 'an item a customer ordered is no longer available',
    body: `Hi {{customer_first_name}},

Bad news on order #{{order_number}}: the {{product_name}} you ordered is out of stock and will not be back in time to ship what you paid for.

Two options:
1. Swap for {{alternative_product}} — similar price, in stock, would ship today
2. Full refund to your original payment method within 3 business days

Just reply with 1 or 2 and I will handle it.

{{your_name}}`,
    whyItWorks:
      'Leads with the bad news, presents two concrete options, makes the reply one character.',
  },
]

const problemTemplates: Template[] = [
  {
    title: 'Product arrived damaged — replacement',
    useWhen: 'a customer reports a damaged item on arrival',
    body: `Hi {{customer_first_name}},

I am sorry — that is not how it was supposed to arrive. I am sending a replacement {{product_name}} today on expedited shipping at no charge to you. Tracking will follow once it is picked up.

You do not need to return the damaged one. Feel free to toss it, or keep it for parts.

If the replacement shows up in the same condition, reply to this email and I will make it right a different way.

{{your_name}}`,
    whyItWorks:
      'Takes responsibility without over-apologizing, removes the return-shipping friction, leaves a door open.',
  },
  {
    title: 'Refund request — approved',
    useWhen: 'a customer asks for a refund within the return window',
    body: `Hi {{customer_first_name}},

Refund processed for order #{{order_number}} — {{amount}} back to your original payment method. It should land in 3–5 business days depending on your bank.

If it is not there by then, reply to this email with a screenshot of your statement and I will chase it down with our processor.

{{your_name}}`,
    whyItWorks:
      'States the outcome in sentence one, sets expectations on timing, offers a next step if it does not land.',
  },
  {
    title: 'Refund request — outside window, alternative offered',
    useWhen: 'a customer asks for a refund past the policy window',
    body: `Hi {{customer_first_name}},

I cannot issue a cash refund on order #{{order_number}} — it is past our {{window}}-day return window (policy here: {{policy_url}}).

What I can do: {{amount}} in store credit, good for any future order, no expiry. If that works for you, reply and I will add it to your account today.

{{your_name}}`,
    whyItWorks: 'Clear no, specific why, real alternative. No apologizing for the policy.',
  },
  {
    title: 'Angry customer — first de-escalation reply',
    useWhen: 'a customer sends an angry or all-caps email and you need to slow things down',
    body: `Hi {{customer_first_name}},

I hear you — this is not what you paid for and I want to get it fixed today.

To do that I need one thing: {{specific_info_needed}}. Once I have that, I will come back within the hour with a concrete plan (refund, replacement, or something better).

{{your_name}}`,
    whyItWorks:
      'Acknowledges the frustration without groveling, asks for one specific input, commits to a tight timeline.',
  },
  {
    title: 'Wrong item shipped — apology and next steps',
    useWhen: 'the customer received the wrong product',
    body: `Hi {{customer_first_name}},

That is on us — we shipped you {{wrong_item}} instead of the {{correct_item}} you ordered. Here is what is happening now:

1. The correct {{correct_item}} ships today on expedited shipping
2. A prepaid return label for {{wrong_item}} is on the way to your inbox — drop it in any mailbox
3. No charge for either

Tracking for the replacement will follow shortly.

{{your_name}}`,
    whyItWorks: 'Owns the error, numbered steps so the customer knows exactly what happens next.',
  },
]

const billingTemplates: Template[] = [
  {
    title: 'Duplicate charge — investigating',
    useWhen: 'a customer reports they were charged twice',
    body: `Hi {{customer_first_name}},

I see both charges on my end. I have refunded the duplicate {{amount}} to your original payment method — it should appear in 3–5 business days.

If you see anything else off on your statement, reply with the details and I will look at it today.

{{your_name}}`,
    whyItWorks:
      'Confirms the customer is seeing what they are seeing, states the action taken, sets a return-door for more.',
  },
  {
    title: 'Subscription cancellation confirmation',
    useWhen: 'a customer cancels a recurring subscription',
    body: `Hi {{customer_first_name}},

Confirmed — your {{plan_name}} subscription is cancelled. You will not be charged again. You can keep using the service until {{end_of_period}}, then it will switch off.

If you change your mind before then, reply to this email and I will turn it back on with no gap.

Thanks for giving it a try,
{{your_name}}`,
    whyItWorks:
      'No guilt trip, no "are you sure", just clear confirmation and a low-friction reactivation path.',
  },
]

const proactiveTemplates: Template[] = [
  {
    title: 'First-response acknowledgement',
    useWhen:
      'a real reply will take longer than 2 hours but the customer should not wonder if you got the message',
    body: `Hi {{customer_first_name}},

Got your message. I am looking into this now — expect a real reply from me within {{timeframe}}.

If anything new comes up in the meantime, feel free to reply on this thread.

{{your_name}}`,
    whyItWorks:
      'Proves a human saw the message, commits to a specific timeframe, keeps the thread open.',
  },
  {
    title: 'Post-resolution follow-up',
    useWhen: 'a ticket was closed 24–48 hours ago and you want to confirm it actually worked',
    body: `Hi {{customer_first_name}},

Checking in on the {{issue}} from earlier this week — did the {{resolution}} actually sort it out for you?

If not, reply and I will pick it back up. If yes, no reply needed.

{{your_name}}`,
    whyItWorks:
      'Makes the reply optional, which increases reply rate for cases where something is still broken.',
  },
  {
    title: 'Review or feedback request after positive resolution',
    useWhen: 'a customer just had a good outcome and is in a good moment to share it',
    body: `Hi {{customer_first_name}},

Glad we got {{issue}} sorted. If you have 30 seconds, would you mind leaving us a quick review here: {{review_link}}

It genuinely helps people find us. If not, no worries — appreciate you either way.

{{your_name}}`,
    whyItWorks: 'Asks only after a win, gives a time estimate, makes the no-answer answer easy.',
  },
]

const edgeCaseTemplates: Template[] = [
  {
    title: 'The polite catch-up',
    useWhen:
      'a customer emails "I never heard back" and you find their original message sitting in a queue',
    body: `Hi {{customer_first_name}},

You are right — your {{date}} message did not get a reply, and that is on us. Sorry about that.

On the original question: {{answer}}.

If that covers it, nothing else needed. If not, reply here and I will come back within the hour.

{{your_name}}`,
    whyItWorks:
      'Skips the defensive explanation, gives the answer they were originally waiting for, offers a fast next step.',
  },
  {
    title: 'Saying no to a feature request',
    useWhen: 'a customer asks for something you will not build',
    body: `Hi {{customer_first_name}},

Thanks for writing in about {{feature}}. Being honest with you: it is not something we are planning to build.

The reason is {{brief_reason}}. If that changes, I will email you directly.

In the meantime, a couple of tools that do this well: {{alternative_1}}, {{alternative_2}}.

{{your_name}}`,
    whyItWorks:
      'Direct no, one-line why, and a useful alternative — customers remember honesty, not yeses that never ship.',
  },
]

const faqs = [
  {
    question: 'Can I actually use these verbatim?',
    answer:
      'You can — but the templates read better after a light pass in your own voice. Swap the placeholders, drop one sentence, add a detail specific to the order. Verbatim copy-paste at scale eventually reads robotic.',
  },
  {
    question: 'Do you have templates for other scenarios?',
    answer:
      'These 15 cover the 80% of support email situations most small businesses hit. We also publish dedicated packs for refund requests and shipping delays — see the related tools below.',
  },
  {
    question: 'How do I customize these for my brand voice?',
    answer:
      'Pick one template, rewrite it in how you actually talk (look at your last five sent emails for reference), and use that as your model for the rest. Fifteen templates in one style beats fifty in a style that is not yours.',
  },
  {
    question: 'Is there a Shopify, Gorgias, or Gmail version?',
    answer:
      'The templates are plain text — paste them into any tool that sends email. If you use a help desk that supports saved replies (Gorgias, Help Scout, Auxx.ai), paste them in as canned responses and use merge fields for the placeholders.',
  },
  {
    question: 'Why only 15 templates instead of 50?',
    answer:
      'Fifty template dumps look impressive and get used by nobody. Fifteen covers the situations you actually hit weekly and leaves room to memorize them. Add your own over time as edge cases show up.',
  },
  {
    question: 'Can I share these with my team?',
    answer:
      'Yes. Share the URL freely. We ask only that you do not repackage and resell the templates.',
  },
]

function Sidebar() {
  return (
    <div className='space-y-3'>
      <h2 className='text-sm font-semibold'>Email me the pack</h2>
      <p className='text-xs text-muted-foreground'>
        We&apos;ll send all 15 templates straight to your inbox. You can also copy them from the
        page below — no signup needed.
      </p>
      <LeadCaptureForm
        toolSlug={TOOL_SLUG}
        buttonLabel='Send me the pack'
        successMessage="Thanks — we'll email your copy shortly. In the meantime, the templates are also on this page for copy-paste."
        disclaimer="We'll email the pack plus the occasional note on running support better. Unsubscribe any time."
      />
    </div>
  )
}

function ItemListJsonLd() {
  const allTemplates = [
    ...orderTemplates,
    ...problemTemplates,
    ...billingTemplates,
    ...proactiveTemplates,
    ...edgeCaseTemplates,
  ]
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: allTemplates.map((template, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: template.title,
    })),
  }
  return (
    <script
      type='application/ld+json'
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  )
}

export default function CustomerSupportEmailTemplatesPage() {
  return (
    <>
      <ItemListJsonLd />
      <ToolLayout
        breadcrumb={[
          { name: 'Home', href: 'https://auxx.ai' },
          { name: 'Free Tools', href: 'https://auxx.ai/free-tools' },
          { name: 'Customer Support Email Templates' },
        ]}
        title='Customer Support Email Templates'
        subhead='15 support email templates for small businesses. Copy-paste right from the page. Free, no signup.'
        sidebar={<Sidebar />}
        faqs={faqs}
        relatedTools={[
          {
            title: 'Refund Request Response Templates',
            href: '/free-tools/refund-request-response-templates',
            description: '8 templates for approving, denying, and investigating refund requests.',
          },
          {
            title: 'Shipping Delay Email Templates',
            href: '/free-tools/shipping-delay-email-templates',
            description: 'Proactive and reactive templates for late orders.',
          },
          {
            title: 'Customer Support KPI Cheat Sheet',
            href: '/free-tools/customer-support-kpis',
            description: '12 metrics every small support team should track.',
          },
        ]}
        productCta={{
          heading: 'Sending the same reply on repeat?',
          description:
            'Auxx.ai unifies your support inbox, canned replies, and customer history in one place.',
          href: '/what-is-auxx-ai',
          label: 'See how Auxx.ai works',
        }}>
        <p>
          Templates save time on the 80% of tickets that repeat. Order confirmations. Shipping
          updates. Refund windows. These are the ones where a well-written template — used as a
          starting point, not a crutch — lets you reply in under a minute without every email
          feeling like homework.
        </p>
        <p>
          These 15 templates are the ones we see small teams reach for most often. Copy them from
          the page, paste into Gmail or your help desk as saved replies, and swap the{' '}
          <code>{`{{placeholders}}`}</code> for the real details.
        </p>

        <h2>When to use templates (and when not to)</h2>
        <p>
          <strong>Good fits:</strong> order confirmations, shipping delay heads-ups, refund
          approvals, subscription cancellation confirmations, post-resolution check-ins. Anything
          transactional.
        </p>
        <p>
          <strong>Write from scratch instead:</strong> angry customers with specific complaints,
          escalations that mention legal or reputational threats, long-time customers with a new
          situation, anything emotionally loaded. A template reads cold in those moments.
        </p>

        <h2>Order acknowledgements and fulfillment</h2>
        {orderTemplates.map((template) => (
          <TemplateBlock key={template.title} {...template} />
        ))}

        <h2>Problems and escalations</h2>
        {problemTemplates.map((template) => (
          <TemplateBlock key={template.title} {...template} />
        ))}

        <h2>Billing and account</h2>
        {billingTemplates.map((template) => (
          <TemplateBlock key={template.title} {...template} />
        ))}

        <h2>Proactive and relationship</h2>
        {proactiveTemplates.map((template) => (
          <TemplateBlock key={template.title} {...template} />
        ))}

        <h2>Edge cases</h2>
        {edgeCaseTemplates.map((template) => (
          <TemplateBlock key={template.title} {...template} />
        ))}

        <h2>How to write your own support emails</h2>
        <ul>
          <li>Lead with the outcome, not the apology — customers want the fix, not the sorry</li>
          <li>Skip "we apologize for the inconvenience" unless something is actually late</li>
          <li>Use the customer&apos;s first name once, not three times</li>
          <li>Keep it under 150 words — most support emails can be</li>
          <li>End with a specific next step (reply here, wait for tracking, etc.)</li>
          <li>Sign with a real human name, not "the team"</li>
        </ul>

        <h2>Templates are a starting point</h2>
        <p>
          Paste any of these verbatim and they will land fine once or twice. Paste them 50 times a
          week and the thread starts reading like a form letter. A good pattern: keep the template
          structure (opener, key facts, specific next step, sign-off) but rewrite one sentence each
          time in language that fits what the customer actually said.
        </p>

        <h2>When your inbox outgrows canned replies</h2>
        <p>
          Templates in Gmail drafts start to crack around 50+ tickets a day. You lose track of who
          replied already, who is waiting, and which version of which template was sent. That is
          when a help desk with proper saved replies, customer history, and ticket status earns its
          keep.
        </p>
        <p>
          Auxx.ai is an all-in-one support inbox and CRM for small businesses — saved replies,
          customer timelines, and ticket tracking in one place.{' '}
          <Link href='/what-is-auxx-ai'>See how Auxx.ai works →</Link>
        </p>
      </ToolLayout>
    </>
  )
}
