// apps/homepage/src/app/free-tools/sla-calculator/page.tsx

import { getHomepageUrl } from '@auxx/config/client'
import type { Metadata } from 'next'
import Link from 'next/link'
import { ToolLayout } from '../_components/tool-layout'
import { SlaCalculator } from './_components/sla-calculator'

const CANONICAL = getHomepageUrl('/free-tools/sla-calculator')

export const metadata: Metadata = {
  title: 'Customer Support SLA Calculator — How Many Agents Do You Need? | Auxx.ai',
  description:
    'Free customer support SLA calculator. Enter your ticket volume, coverage hours, and target response time to see how many agents you need.',
  alternates: { canonical: CANONICAL },
  openGraph: {
    title: 'Customer Support SLA Calculator',
    description: 'How many agents do you need to hit your SLA?',
    url: CANONICAL,
    type: 'website',
  },
}

const faqs = [
  {
    question: 'How do you calculate SLA staffing requirements?',
    answer:
      'Tickets per day multiplied by average handle time gives you total minutes of work. Divide by effective agent hours (coverage × utilization) to get base agent count. We add a buffer proportional to how tight your SLA is relative to handle time. For high-precision staffing, queueing theory (Erlang C) is the next step up.',
  },
  {
    question: 'What is a reasonable response SLA for a small support team?',
    answer:
      'For email, a 4-hour response SLA during business hours is a strong target that most small teams can hit with 1–3 agents. For live chat, 2 minutes. Start with what you already do on a good day, then tighten from there.',
  },
  {
    question: 'Does this account for volume spikes and seasonal peaks?',
    answer:
      'No. It assumes steady state. For holiday peaks, plug your peak-day volume into "tickets per day" and see what that requires. Most teams run at the "amber" level day-to-day and staff up seasonally.',
  },
  {
    question: 'What is the difference between response SLA and resolution SLA?',
    answer:
      'Response SLA is the time until a human first replies. Resolution SLA is the time until the ticket is closed. This calculator targets response SLA, which is the harder one to hit under staff pressure.',
  },
  {
    question: 'How does average handle time affect my agent count?',
    answer:
      'Linearly. If your average handle time doubles from 8 to 16 minutes, your required agent count roughly doubles too. Shaving 2 minutes off handle time through better saved replies or macros has a bigger staffing impact than most teams realize.',
  },
  {
    question: 'Is this calculator accurate for live chat?',
    answer:
      'The math is. Set coverage hours to match your chat staffing window and use short SLA targets (1–15 minutes). Live chat handle time is usually 3–6 minutes, not 8.',
  },
]

function SoftwareAppJsonLd() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Customer Support SLA Calculator',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    url: CANONICAL,
  }
  return (
    <script
      type='application/ld+json'
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  )
}

export default function SlaCalculatorPage() {
  return (
    <>
      <SoftwareAppJsonLd />
      <ToolLayout
        breadcrumb={[
          { name: 'Home', href: 'https://auxx.ai' },
          { name: 'Free Tools', href: 'https://auxx.ai/free-tools' },
          { name: 'SLA Calculator' },
        ]}
        title='Customer Support SLA Calculator'
        subhead='Figure out how many agents you need to hit your target response time. Free, no signup.'
        faqs={faqs}
        relatedTools={[
          {
            title: 'First Response Time Calculator',
            href: '/free-tools/first-response-time-calculator',
            description: 'Measure your actual FRT from real ticket timestamps.',
          },
          {
            title: 'Customer Support KPI Cheat Sheet',
            href: '/free-tools/customer-support-kpis',
            description: '12 metrics every small support team should track.',
          },
          {
            title: 'Customer Support Email Templates',
            href: '/free-tools/customer-support-email-templates',
            description: '15 copy-paste support email templates.',
          },
        ]}
        productCta={{
          heading: 'Calculator says you need 3 agents.',
          description:
            'Auxx.ai tracks whether they are actually hitting SLA on every ticket — not just in theory.',
          href: '/what-is-auxx-ai',
          label: 'See how Auxx.ai works',
        }}>
        <SlaCalculator />

        <h2>How this calculator works</h2>
        <p>
          The math is intentionally simple. Each agent has a certain number of minutes per day
          available for ticket work — coverage hours times utilization (the share of the shift that
          is actually on tickets, not breaks or admin). Divide total ticket-minutes needed by
          per-agent capacity, round up, and add a small buffer if the target SLA is tight relative
          to your average handle time.
        </p>
        <p>
          This is a back-of-envelope tool. It will tell you whether you need 2 agents or 5. It will
          not tell you the difference between 3.2 and 3.4. For that, a proper queueing model (Erlang
          C) or historical data is more useful.
        </p>

        <h2>What is an SLA for customer support?</h2>
        <p>
          A service-level agreement (SLA) in support is a commitment to how fast you will respond
          (response SLA) or resolve (resolution SLA) a ticket. It can be internal — a target the
          team is trying to hit — or external, published to customers. Either way, the math is the
          same: you need enough capacity during enough hours to reply before the clock runs out.
        </p>

        <h2>Common support SLA targets by channel</h2>
        <ul>
          <li>
            <strong>Email:</strong> 4–24 hr response, 24–48 hr resolution
          </li>
          <li>
            <strong>Live chat:</strong> 30 sec–2 min response, same-session resolution
          </li>
          <li>
            <strong>Phone:</strong> 30 sec pickup, same-call resolution
          </li>
          <li>
            <strong>Social:</strong> 30 min–4 hr response
          </li>
        </ul>

        <h2>Setting realistic SLAs</h2>
        <ul>
          <li>Start with what you already do on a good day, not what you wish you did</li>
          <li>Tier by priority — urgent tickets get tighter SLAs than feature requests</li>
          <li>Tier by customer type — enterprise or paid tiers can get faster response</li>
          <li>Measure for at least 30 days before you publish the number externally</li>
          <li>Publish the SLA internally before tying it to agent performance</li>
        </ul>

        <h2>From calculator to dashboard</h2>
        <p>
          The calculator runs once. A help desk with real-time SLA tracking tells you whether you
          are hitting the target ticket-by-ticket. <Link href='/what-is-auxx-ai'>Auxx.ai</Link>{' '}
          gives every small team a live view of FRT, SLA compliance, and resolution time — so you
          can see the gap between what the calculator says and what is actually happening.
        </p>
      </ToolLayout>
    </>
  )
}
