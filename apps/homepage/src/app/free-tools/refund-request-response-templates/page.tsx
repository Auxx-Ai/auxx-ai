// apps/homepage/src/app/free-tools/refund-request-response-templates/page.tsx

import { getHomepageUrl } from '@auxx/config/client'
import type { Metadata } from 'next'
import Link from 'next/link'
import { LeadCaptureForm } from '../_components/lead-capture-form'
import { TemplateBlock } from '../_components/template-block'
import { ToolLayout } from '../_components/tool-layout'

const TOOL_SLUG = 'refund-request-response-templates'
const CANONICAL = getHomepageUrl(`/free-tools/${TOOL_SLUG}`)

export const metadata: Metadata = {
  title: '8 Free Refund Email Templates — Approve, Deny, Investigate | Auxx.ai',
  description:
    '8 refund request response templates for small businesses. Copy-paste approvals, denials, and investigation replies. Free, no signup required.',
  alternates: { canonical: CANONICAL },
  openGraph: {
    title: '8 Free Refund Email Templates',
    description: 'Templates for approving, denying, and investigating refund requests.',
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

const approvalTemplates: Template[] = [
  {
    title: 'Refund approved — within policy, processed immediately',
    useWhen: 'a customer requests a refund inside your return window',
    body: `Hi {{customer_first_name}},

Refund processed for order #{{order_number}} — {{amount}} back to your original payment method. It should land in 3–5 business days depending on your bank.

If it is not there by then, reply with a statement screenshot and I will chase it with our processor.

Thanks for giving us a try,
{{your_name}}`,
    whyItWorks:
      'Decision in the first line, timing expectation set, explicit return path if something goes wrong.',
  },
  {
    title: 'Refund approved — goodwill exception outside policy',
    useWhen: 'technically out of policy but the customer situation warrants a one-time exception',
    body: `Hi {{customer_first_name}},

Normally we cannot refund orders past our {{window}}-day window, but in this case I am making an exception. {{amount}} is heading back to your original payment method now, 3–5 business days to land.

If something similar comes up again, reply here and we will figure it out together — please do not assume the window does not apply going forward.

{{your_name}}`,
    whyItWorks:
      'Makes the goodwill explicit, protects the policy for future cases, keeps the relationship warm.',
  },
  {
    title: 'Partial refund approved — item returned in non-resellable condition',
    useWhen: 'the item came back damaged, used, or missing parts',
    body: `Hi {{customer_first_name}},

Thanks for sending the {{product_name}} back. It came back {{condition_note}}, so I can refund {{partial_amount}} of the original {{full_amount}} — the rest covers what we lose reselling it.

The partial refund is processing now, 3–5 business days to your original payment method. If you want to discuss the amount, reply and I will walk you through the photos.

{{your_name}}`,
    whyItWorks:
      'Transparent math, shows the photos are there if asked, no apology for the partial.',
  },
]

const denialTemplates: Template[] = [
  {
    title: 'Refund denied — outside return window, store credit offered',
    useWhen: 'the request is clearly past the policy window',
    body: `Hi {{customer_first_name}},

I cannot issue a cash refund on order #{{order_number}} — it is {{days_past}} days past our {{window}}-day return window (policy: {{policy_url}}).

What I can do: {{credit_amount}} in store credit, good for any future order, no expiry. Reply if that works and I will add it to your account today.

{{your_name}}`,
    whyItWorks:
      'Firm no, specific numbers, real alternative. No apologizing for the policy existing.',
  },
  {
    title: 'Refund denied — digital or non-returnable product',
    useWhen: 'the product is digital, personalized, or otherwise non-returnable by policy',
    body: `Hi {{customer_first_name}},

{{product_name}} is not something I can refund — it is {{reason: a digital download, a custom/made-to-order item, etc.}} and our policy flags those as non-returnable (details: {{policy_url}}).

If the product is not working for you, reply with a bit more on what is off. If it is a bug or defect we will replace it. If it is a fit issue, I can offer {{discount_percent}}% off your next order.

{{your_name}}`,
    whyItWorks:
      'Separates "policy no" from "is something actually broken?" — which is the better question to ask.',
  },
  {
    title: 'Refund denied — item was as described, troubleshooting offered',
    useWhen: 'the customer is unhappy but the product is performing as advertised',
    body: `Hi {{customer_first_name}},

I took a look — {{product_name}} is doing what it should, based on what you described. I cannot refund it on that basis, but I would like to get it working for you.

Can you tell me:
1. {{specific_question_1}}
2. {{specific_question_2}}

Once I have those, I will walk you through the fix. Usually it takes 5 minutes.

{{your_name}}`,
    whyItWorks:
      'Offers the help first, asks specific questions, keeps the refund door closed without being harsh.',
  },
]

const holdTemplates: Template[] = [
  {
    title: 'Refund under review — need more info',
    useWhen: 'you need photos, order number, or other details to process',
    body: `Hi {{customer_first_name}},

Happy to look at this — I just need a couple of things to process it:

1. {{requirement_1: order number, photos of the damage, etc.}}
2. {{requirement_2}}

Reply with those and I will have a decision back within 24 hours.

{{your_name}}`,
    whyItWorks:
      'Does not refuse, does not promise. Sets a clear tight SLA for when a decision will come.',
  },
  {
    title: 'Double-charge refund — confirmed and processed',
    useWhen: 'a customer was charged twice and you can see both transactions',
    body: `Hi {{customer_first_name}},

I see both charges on my end — {{duplicate_amount}} on {{date_1}} and {{date_2}}. The duplicate is refunded, 3–5 business days to your original payment method.

I also checked your other recent orders — everything else looks right. If you see anything else off on your statement, reply with the details.

{{your_name}}`,
    whyItWorks:
      'Confirms what the customer saw, takes the action before they ask again, offers a broader check.',
  },
]

const faqs = [
  {
    question: 'Do I have to offer a refund by law?',
    answer:
      'It varies by country and jurisdiction. In the EU, 14-day cooling-off periods on online orders are standard. In the US, refund law is largely set by your own published policy. These templates are not legal advice — check your jurisdiction or a lawyer if the request is borderline.',
  },
  {
    question: "What's the difference between a refund and a chargeback?",
    answer:
      'A refund is you voluntarily sending money back. A chargeback is the customer asking their bank to reverse the charge, which then costs you the original amount, a fee ($15–25 typically), and potentially your processor relationship if it happens too often. Handling a refund gracefully almost always beats a chargeback.',
  },
  {
    question: 'How do I respond to a chargeback threat in an email?',
    answer:
      'Do not match the threat energy. Acknowledge the request, state what you can do within policy, and let them decide. If they file anyway, you fight it through your processor with documentation — not in the email thread.',
  },
  {
    question: 'Should I always offer store credit as an alternative?',
    answer:
      'For out-of-window requests, usually yes — store credit costs less than a cash refund and keeps the relationship. Do not offer it as a first response to an in-window request; that reads as trying to dodge a legitimate refund.',
  },
  {
    question: 'How long does it take to process a refund?',
    answer:
      'On your side, seconds. On the customer-bank side, 3–5 business days is standard for credit cards. Bank transfers can take a week. Tell the customer upfront so they do not email again on day 4.',
  },
  {
    question: 'Can I refuse a refund if the policy is clearly posted?',
    answer:
      'Usually yes, but "legally allowed" and "worth doing" are different questions. Refund policies are a marketing lever — a too-strict one costs you in reviews and repeat customers. Judge case by case.',
  },
]

function Sidebar() {
  return (
    <div className='space-y-3'>
      <h2 className='text-sm font-semibold'>Email me the pack</h2>
      <p className='text-xs text-muted-foreground'>
        We&apos;ll send all 8 refund templates straight to your inbox. You can also copy them from
        the page below — no signup needed.
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
  const all = [...approvalTemplates, ...denialTemplates, ...holdTemplates]
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

export default function RefundRequestResponseTemplatesPage() {
  return (
    <>
      <ItemListJsonLd />
      <ToolLayout
        breadcrumb={[
          { name: 'Home', href: 'https://auxx.ai' },
          { name: 'Free Tools', href: 'https://auxx.ai/free-tools' },
          { name: 'Refund Request Response Templates' },
        ]}
        title='Refund Request Response Templates'
        subhead='8 email templates for approving, denying, and investigating refund requests. Copy-paste right from the page. Free, no signup.'
        sidebar={<Sidebar />}
        faqs={faqs}
        relatedTools={[
          {
            title: 'Customer Support Email Templates',
            href: '/free-tools/customer-support-email-templates',
            description: '15 copy-paste templates for the 80% of support emails that repeat.',
          },
          {
            title: 'Shipping Delay Email Templates',
            href: '/free-tools/shipping-delay-email-templates',
            description: 'Proactive and reactive templates for late orders.',
          },
          {
            title: 'First Response Time Calculator',
            href: '/free-tools/first-response-time-calculator',
            description: 'Benchmark your FRT against industry norms.',
          },
        ]}
        productCta={{
          heading: 'Tired of copy-pasting the same refund reply?',
          description:
            'Auxx.ai keeps canned replies, order context, and customer history in one inbox.',
          href: '/what-is-auxx-ai',
          label: 'See how Auxx.ai works',
        }}>
        <p>
          <em>
            These templates are not legal advice. Refund rules vary by country and product category
            — check your jurisdiction if the request is borderline.
          </em>
        </p>

        <p>
          Refund requests split into a small, predictable set of scenarios: inside-policy approvals,
          goodwill exceptions, policy-backed denials, and cases that need more info before you can
          decide. These 8 templates cover all of them, written to be firm without being cold.
        </p>

        <h2>The refund response framework</h2>
        <p>Every template below follows the same four-beat structure:</p>
        <ol>
          <li>
            <strong>Acknowledge the request.</strong> Not the feeling — do not start with "I am so
            sorry you are feeling this way". Just confirm you saw the request.
          </li>
          <li>
            <strong>State the decision clearly in sentence two.</strong> Approved. Denied.
            Investigating. No runway before the answer.
          </li>
          <li>
            <strong>Explain the why briefly.</strong> Link the policy, do not paste it. One line of
            reasoning is enough.
          </li>
          <li>
            <strong>Offer a next step.</strong> Refund timing, alternative (store credit, discount,
            replacement), or what you need from them to decide.
          </li>
        </ol>

        <h2>Approvals</h2>
        {approvalTemplates.map((t) => (
          <TemplateBlock key={t.title} {...t} />
        ))}

        <h2>Denials with alternative</h2>
        {denialTemplates.map((t) => (
          <TemplateBlock key={t.title} {...t} />
        ))}

        <h2>Holds and investigations</h2>
        {holdTemplates.map((t) => (
          <TemplateBlock key={t.title} {...t} />
        ))}

        <h2>When to break the template</h2>
        <p>
          Some refund threads deserve a from-scratch reply instead of a template. Skip the templates
          and write fresh when you see:
        </p>
        <ul>
          <li>
            A high-value or long-time customer — they can tell when they are getting the canned
            response
          </li>
          <li>Legal-adjacent language: "chargeback", "BBB", "my lawyer", "dispute"</li>
          <li>
            A repeat issue from the same customer — the second refund request is a relationship
            conversation, not a policy one
          </li>
          <li>
            Anything emotionally loaded — a template reads cold when someone is genuinely upset
          </li>
        </ul>

        <h2>Refund policy principles</h2>
        <ul>
          <li>Publish your refund policy publicly, before a customer has to ask for it</li>
          <li>State the window in specific days, not "a reasonable time"</li>
          <li>
            Spell out which products are non-returnable (digital, personalized, intimate,
            perishable)
          </li>
          <li>Clarify who pays return shipping — the most common point of dispute</li>
          <li>
            Specify the refund method: original payment, store credit, or either at the
            customer&apos;s choice
          </li>
        </ul>

        <h2>Shrinking the volume of refund requests</h2>
        <p>
          Most refund requests trace back to a pre-purchase mismatch: the product description was
          vague, the shipping time was longer than expected, the photos did not show the real color,
          the size chart was wrong. Before optimizing your refund replies, look at your last 20
          refund threads and find the pattern — one product-page edit might cut the incoming volume
          by 30%.
        </p>
        <p>
          Once you are handling enough refund threads that templates are not scaling, a help desk
          that ties every ticket to the customer&apos;s full order history starts to matter. You see
          repeat requesters. You see which products generate disproportionate refund requests. You
          see resolution time by agent. <Link href='/platform/crm'>Auxx.ai&apos;s CRM</Link> is
          built for exactly that.
        </p>
      </ToolLayout>
    </>
  )
}
