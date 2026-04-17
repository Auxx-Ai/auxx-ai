// apps/homepage/src/app/free-tools/shipping-delay-email-templates/page.tsx

import { getHomepageUrl } from '@auxx/config/client'
import type { Metadata } from 'next'
import Link from 'next/link'
import { LeadCaptureForm } from '../_components/lead-capture-form'
import { TemplateBlock } from '../_components/template-block'
import { ToolLayout } from '../_components/tool-layout'

const TOOL_SLUG = 'shipping-delay-email-templates'
const CANONICAL = getHomepageUrl(`/free-tools/${TOOL_SLUG}`)

export const metadata: Metadata = {
  title: '7 Free Shipping Delay Email Templates (Copy-Paste) | Auxx.ai',
  description:
    '7 shipping delay email templates — proactive updates, tracking follow-ups, and refund offers. Free copy-paste templates, no signup required.',
  alternates: { canonical: CANONICAL },
  openGraph: {
    title: '7 Free Shipping Delay Email Templates',
    description: 'Templates for telling customers their order is late.',
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

const proactiveTemplates: Template[] = [
  {
    title: 'Generic shipping delay — proactive heads-up',
    useWhen: 'an order is past the promised ship date and you know the new ETA',
    body: `Hi {{customer_first_name}},

Quick update on order #{{order_number}}: it is going to ship {{new_eta}} instead of the original {{original_eta}}. The reason is {{brief_cause}}.

Tracking will go out the moment it leaves the warehouse. If the new date does not work for you, reply to this email and I will sort out a refund or swap in something that ships faster.

Sorry for the bump,
{{your_name}}`,
    whyItWorks:
      'Specific new date, one-line cause, clear opt-out. Beats "we apologize for the inconvenience" every time.',
  },
  {
    title: 'Carrier delay — "it is not us, it is UPS/USPS"',
    useWhen: 'the carrier is sitting on the package and tracking has not updated',
    body: `Hi {{customer_first_name}},

Your order #{{order_number}} left our warehouse {{ship_date}} and is currently stuck with {{carrier}} — tracking has not updated in {{days}} days. Tracking link: {{tracking_url}}

I have opened a case with {{carrier}} to locate it. Expected update: {{next_update_time}}.

Two options if it does not move by then: a replacement on expedited shipping, or a full refund. Reply with which you prefer and I will have it ready.

{{your_name}}`,
    whyItWorks:
      'Facts first, tracking link included, proactive case opened, two concrete next options.',
  },
  {
    title: 'Weather or holiday delay',
    useWhen: 'a known external event is causing widespread slowdowns',
    body: `Hi {{customer_first_name}},

A heads-up on order #{{order_number}}: {{event: "major winter storm across the Midwest", "holiday carrier backup", etc.}} is delaying shipments across the region. Current best-estimate delivery: {{new_eta}}.

We are not doing anything special on our end — just a realistic update so you are not refreshing tracking all week. If the new date becomes a problem, reply and we will figure something out.

{{your_name}}`,
    whyItWorks:
      'Honest about the cause, realistic estimate, no false urgency, low-friction escape hatch.',
  },
]

const reactiveTemplates: Template[] = [
  {
    title: 'Customer asked "where is my order?" — tracking update',
    useWhen: 'a customer emails asking about their order status',
    body: `Hi {{customer_first_name}},

Just checked on order #{{order_number}} for you. {{status_summary: "Shipped on Monday, currently in transit, last scan in Memphis on Wednesday morning", etc.}}.

Tracking: {{tracking_url}}
Current estimate: {{delivery_estimate}}

If it does not move in the next {{timeframe}}, reply and I will open a case with the carrier.

{{your_name}}`,
    whyItWorks:
      'Shows you actually looked, gives the concrete status, sets a specific trigger for next action.',
  },
  {
    title: 'Order lost in transit — replacement offered',
    useWhen: 'tracking shows the package is lost or delivered-but-not-received',
    body: `Hi {{customer_first_name}},

Bad news on order #{{order_number}}: it is not showing up and {{carrier}} has flagged it as {{status: "lost in transit", "delivered but not at your address", etc.}}.

I am shipping a replacement today on expedited shipping at no charge — no need to wait on the carrier investigation. Tracking will follow within the hour.

If the original somehow turns up later, you are welcome to keep it or send it back with the prepaid label I will include.

{{your_name}}`,
    whyItWorks:
      'Takes the loss, skips the customer having to chase the carrier, removes return friction.',
  },
]

const escalationTemplates: Template[] = [
  {
    title: 'Significant delay (>7 days) — partial refund offered proactively',
    useWhen:
      'an order is more than a week past the promised date and you want to get ahead of frustration',
    body: `Hi {{customer_first_name}},

Order #{{order_number}} is {{days_late}} days past the date I told you. That is on us, not on you to chase.

Here is what I am offering without you having to ask:
1. {{refund_amount}} back to your original payment method as a partial refund for the delay — processing today
2. Your order will still arrive on {{best_estimate}} (current tracking: {{tracking_url}})
3. If you would rather cancel entirely, reply and I will refund the full order instead

{{your_name}}`,
    whyItWorks:
      'Proactive refund before the customer asks, clear options, acknowledges this is not a normal delay.',
  },
  {
    title: 'Backorder — wait, substitute, or refund',
    useWhen: 'an item is out of stock and will not ship within an acceptable window',
    body: `Hi {{customer_first_name}},

Update on order #{{order_number}}: the {{product_name}} is back-ordered — next stock lands {{restock_eta}}, so it would ship around {{ship_eta}}.

Three options:
1. Wait for the restock and ship then (no extra charge)
2. Swap for {{alternative_product}} — similar price, in stock, ships today
3. Full refund to your original payment method

Reply with 1, 2, or 3 and I will sort it today.

{{your_name}}`,
    whyItWorks:
      'Transparent about the new date, three specific options with one-character replies, no guilt.',
  },
]

const faqs = [
  {
    question: 'How early should I send a delay email?',
    answer:
      'As soon as you know the order will not ship on the promised date — usually 1–2 days after the expected ship date passes without movement. Proactive emails reduce inbound "where is my order?" tickets by a lot.',
  },
  {
    question: 'Should I offer a refund automatically or wait for the customer to ask?',
    answer:
      'For delays under 3–4 days past the promised date, an update without a refund offer is fine. For delays over a week, offer a partial refund proactively — it costs less than the review damage and lost repeat business.',
  },
  {
    question: "What do I say when I don't know the new ETA yet?",
    answer:
      'Say exactly that. "I do not have a firm new date yet — will email you within 24 hours once I confirm with the carrier." Silence during a delay is worse than uncertainty that comes with a timestamp.',
  },
  {
    question: 'Is it better to blame the carrier or take responsibility?',
    answer:
      'Facts are fine — "your package is stuck with UPS" is a real piece of information. But finish with what you are doing about it. "Stuck with UPS, I opened a case, will update you by Friday" beats "stuck with UPS, nothing we can do".',
  },
  {
    question: 'Do I send the same email for a 1-day delay and a 2-week delay?',
    answer:
      'No. A 1-day delay gets a short heads-up. A 1-week delay gets a heads-up with a soft opt-out offer. A 2-week delay gets a proactive partial refund before they ask. The tone and the offer scale with the severity.',
  },
  {
    question: 'How do I handle delays during the holiday rush?',
    answer:
      'Two things. First, set realistic shipping estimates on product pages and at checkout before November starts — under-promise. Second, have a batch-send template ready for carrier-wide backups so you can update 200 customers in an hour instead of 200 individual threads.',
  },
]

function Sidebar() {
  return (
    <div className='space-y-3'>
      <h2 className='text-sm font-semibold'>Email me the pack</h2>
      <p className='text-xs text-muted-foreground'>
        We&apos;ll send all 7 shipping delay templates straight to your inbox. You can also copy
        them from the page below — no signup needed.
      </p>
      <LeadCaptureForm
        toolSlug={TOOL_SLUG}
        buttonLabel='Send me the pack'
        successMessage="Thanks — we'll email your copy shortly. In the meantime, the templates are also on this page for copy-paste."
        disclaimer="We'll email the pack plus occasional notes on running support better. Unsubscribe any time."
      />
    </div>
  )
}

function ItemListJsonLd() {
  const all = [...proactiveTemplates, ...reactiveTemplates, ...escalationTemplates]
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: all.map((t, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: t.title,
    })),
  }
  return (
    <script
      type='application/ld+json'
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  )
}

export default function ShippingDelayEmailTemplatesPage() {
  return (
    <>
      <ItemListJsonLd />
      <ToolLayout
        breadcrumb={[
          { name: 'Home', href: 'https://auxx.ai' },
          { name: 'Free Tools', href: 'https://auxx.ai/free-tools' },
          { name: 'Shipping Delay Email Templates' },
        ]}
        title='Shipping Delay Email Templates'
        subhead='7 email templates for telling customers their order is late. Proactive updates, tracking follow-ups, and refund offers. Copy-paste free.'
        sidebar={<Sidebar />}
        faqs={faqs}
        relatedTools={[
          {
            title: 'Customer Support Email Templates',
            href: '/free-tools/customer-support-email-templates',
            description: '15 copy-paste templates for the 80% of support emails that repeat.',
          },
          {
            title: 'Refund Request Response Templates',
            href: '/free-tools/refund-request-response-templates',
            description: '8 templates for approving, denying, and investigating refunds.',
          },
          {
            title: 'First Response Time Calculator',
            href: '/free-tools/first-response-time-calculator',
            description: 'Benchmark your FRT against industry norms.',
          },
        ]}
        productCta={{
          heading: "Customers don't leave because of delays — they leave because of silence.",
          description:
            'Auxx.ai ties orders, conversations, and customer history into one inbox so anyone on the team can pick up a "where is it?" thread.',
          href: '/what-is-auxx-ai',
          label: 'See how Auxx.ai works',
        }}>
        <p>
          Delay emails are not about apologizing. They are about giving the customer enough
          information that they do not have to email you. A good delay email prevents 3 follow-up
          tickets per order.
        </p>

        <h2>The shipping delay framework</h2>
        <p>Every template below follows four rules:</p>
        <ol>
          <li>
            <strong>Notify before the customer notices.</strong> Proactive beats reactive by a wide
            margin on review scores.
          </li>
          <li>
            <strong>Give a specific new ETA.</strong> Not "soon". Not "as soon as possible". A date,
            or a plausible window.
          </li>
          <li>
            <strong>State the cause in one sentence.</strong> Enough to show this is not random. Not
            a paragraph-long supply-chain explainer.
          </li>
          <li>
            <strong>Offer a next step.</strong> Tracking link, refund option, substitute, or just
            when the next update will come.
          </li>
        </ol>

        <h2>Proactive heads-ups</h2>
        {proactiveTemplates.map((t) => (
          <TemplateBlock key={t.title} {...t} />
        ))}

        <h2>Reactive responses</h2>
        {reactiveTemplates.map((t) => (
          <TemplateBlock key={t.title} {...t} />
        ))}

        <h2>Escalations and offers</h2>
        {escalationTemplates.map((t) => (
          <TemplateBlock key={t.title} {...t} />
        ))}

        <h2>When to send a delay email proactively</h2>
        <ul>
          <li>Anything past the promised ship date plus one day</li>
          <li>Carrier exception events visible on the tracking page</li>
          <li>
            Out-of-stock items already paid for — do not wait for the automated "ships in X days"
            email to lapse
          </li>
          <li>Carrier-wide backups: weather, holiday surge, labor disruption</li>
        </ul>
        <p>Before the customer emails you is always cheaper than after.</p>

        <h2>What to say vs. what not to say</h2>
        <p>
          <strong>Do:</strong> a specific new ETA, the cause in one sentence, what they can do now.
        </p>
        <p>
          <strong>Do not:</strong> "we apologize for any inconvenience this may have caused", vague
          "working hard to resolve", blaming the carrier without saying what you are doing about it.
        </p>

        <h2>Delays are a CX problem, not a logistics problem</h2>
        <p>
          Customers rarely churn because of a delay. They churn because of silence during a delay.
          The single cheapest CX upgrade most small stores can make is sending a delay email one day
          earlier than they currently do.
        </p>
        <p>
          When the volume of delay threads gets high enough that you cannot keep track of who you
          notified and who you did not, a help desk that links every order to its conversation
          history starts earning its keep.{' '}
          <Link href='/what-is-auxx-ai'>See how Auxx.ai works →</Link>
        </p>
      </ToolLayout>
    </>
  )
}
