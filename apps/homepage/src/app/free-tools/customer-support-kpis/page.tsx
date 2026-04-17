// apps/homepage/src/app/free-tools/customer-support-kpis/page.tsx

import { getHomepageUrl } from '@auxx/config/client'
import type { Metadata } from 'next'
import Link from 'next/link'
import { LeadCaptureForm } from '../_components/lead-capture-form'
import { ToolLayout } from '../_components/tool-layout'

const TOOL_SLUG = 'customer-support-kpis'
const CANONICAL = getHomepageUrl(`/free-tools/${TOOL_SLUG}`)

export const metadata: Metadata = {
  title: '12 Customer Support KPIs That Actually Matter | Auxx.ai',
  description:
    '12 customer support KPIs that actually matter, with formulas, benchmarks, and common pitfalls. Free reference for small business support teams.',
  alternates: { canonical: CANONICAL },
  openGraph: {
    title: '12 Customer Support KPIs That Actually Matter',
    description: 'Metrics, formulas, and benchmarks for small-business support.',
    url: CANONICAL,
    type: 'website',
  },
}

type Kpi = {
  name: string
  definition: string
  formula: string
  healthy: string
  gotcha: string
}

const speedKpis: Kpi[] = [
  {
    name: 'First Response Time (FRT)',
    definition:
      'Time between when a customer sends a message and when they get a real human reply (not an auto-ack).',
    formula: 'Median of (first_reply_timestamp − customer_message_timestamp) across all tickets.',
    healthy: 'Email: < 4 hrs. Live chat: < 2 min. Social: < 30 min.',
    gotcha:
      'Do not count auto-replies as first response — the number looks great, the customer still feels ignored.',
  },
  {
    name: 'Average Resolution Time (ART)',
    definition: 'Time from ticket creation to ticket closed.',
    formula: 'Median of (closed_at − created_at) across all resolved tickets.',
    healthy: 'Email: < 24 hrs. Live chat: single session. Complex issues: < 72 hrs.',
    gotcha:
      'Auto-close rules skew this down artificially. Report manually-resolved tickets separately if your system auto-closes after N days of silence.',
  },
  {
    name: 'SLA Compliance %',
    definition: 'Share of tickets resolved within the agreed SLA window.',
    formula: '(tickets_resolved_within_SLA / total_resolved_tickets) × 100.',
    healthy: '≥ 90% for internal targets, ≥ 95% if the SLA is contractual.',
    gotcha:
      'A 99% compliance rate with a 24-hour SLA tells you less than a 90% rate with a 4-hour SLA. Track both the SLA target and compliance, never compliance alone.',
  },
  {
    name: 'Time-to-First-Touch on New Customers',
    definition: 'FRT specifically for first-time senders — how fast new customers get a reply.',
    formula: 'Median FRT across tickets where the customer has no prior ticket or order history.',
    healthy: 'Tighter than overall FRT — ideally half of median FRT for the channel.',
    gotcha:
      'First impressions are disproportionately durable. A new customer waiting 6 hours is worse than a repeat customer waiting 6 hours.',
  },
]

const qualityKpis: Kpi[] = [
  {
    name: 'Customer Satisfaction (CSAT)',
    definition: 'Post-resolution rating of the support interaction. Usually 1–5 or thumbs up/down.',
    formula: '(positive_ratings / total_ratings) × 100.',
    healthy: '≥ 85% positive on a thumbs-up/down scale. ≥ 4.5/5 on a 5-point scale.',
    gotcha:
      'If your response rate on the survey drops below 20%, the CSAT number is not statistically meaningful — only the people who felt strongly reply.',
  },
  {
    name: 'Net Promoter Score (NPS)',
    definition:
      'How likely a customer is to recommend your business, on a 0–10 scale. Company-wide, not per-ticket.',
    formula: '(% promoters, 9–10) − (% detractors, 0–6).',
    healthy: '> 30 is good for ecommerce. > 50 is excellent. Negative means you are losing trust.',
    gotcha:
      'NPS is a brand metric, not a support metric. If you are tracking NPS after each ticket you are measuring the wrong moment.',
  },
  {
    name: 'First Contact Resolution (FCR)',
    definition:
      'Share of tickets resolved on the first human reply, without back-and-forth or escalation.',
    formula: '(tickets_closed_on_first_reply / total_tickets) × 100.',
    healthy: '≥ 70% for simple transactional support. ≥ 50% for product-complex support.',
    gotcha:
      "Teams trying to hit an FCR target push 'this should fix it, let me know' replies that close the ticket prematurely. Pair FCR with reopen rate.",
  },
  {
    name: 'Reopen Rate',
    definition: 'Share of closed tickets the customer reopens within 7 days.',
    formula: '(tickets_reopened_within_7_days / tickets_closed) × 100.',
    healthy: '< 10% is healthy. > 20% means tickets are being closed too aggressively.',
    gotcha:
      'A low reopen rate plus a low FCR usually means customers are giving up rather than getting resolved.',
  },
]

const volumeKpis: Kpi[] = [
  {
    name: 'Ticket Volume',
    definition: 'Total tickets received per day, week, and month.',
    formula: 'Count of tickets created in the period, trended over time.',
    healthy:
      'No absolute target — track the trend. Volume growth that outpaces revenue growth signals a product problem.',
    gotcha:
      'Batch-sent marketing emails triggering 200 "wrong email!" replies will spike volume without changing the underlying workload. Exclude those separately.',
  },
  {
    name: 'Backlog',
    definition: 'Open tickets older than 24 hours, checked daily.',
    formula: 'Count of tickets where status = open AND created_at < 24 hours ago.',
    healthy: 'Near zero by end of each business day. Sustained non-zero means you are underwater.',
    gotcha:
      'Teams that move old tickets to "on hold" or "waiting on customer" to clear the queue are optimizing for the number, not the customer. Count those too.',
  },
]

const businessKpis: Kpi[] = [
  {
    name: 'Cost per Ticket',
    definition: 'Fully-loaded support cost divided by tickets resolved in the period.',
    formula:
      '(total_support_team_cost_for_period) / (tickets_resolved_in_period). Include salaries, tools, and allocated overhead.',
    healthy:
      'Varies by business model. Track the trend over time — cost per ticket should fall as the team gets more efficient, or rise for clear reasons (new product, new channel).',
    gotcha:
      'Driving this number down by cutting response quality shows up immediately in CSAT and reopen rate. Optimize as a portfolio, not a single metric.',
  },
  {
    name: 'Support-Driven Retention',
    definition:
      'Share of customers who contacted support in the last 90 days and are still active customers.',
    formula:
      '(customers_who_contacted_support_90d_and_still_active) / (customers_who_contacted_support_90d) × 100.',
    healthy:
      'Should be near or above your overall retention rate. Lower means support contact correlates with churn — a sign the issues behind those tickets are not being fixed at the product level.',
    gotcha:
      'This is a correlation, not a causation number. Use it to spot patterns, not to justify the support budget.',
  },
]

const faqs = [
  {
    question: 'How many KPIs should a support team actually track?',
    answer:
      'Four to six. Pick them based on the actual problem you are trying to solve — speed, quality, volume, or cost. Tracking 12 at once is dashboard porn and nobody looks at it past month two.',
  },
  {
    question: "What's the difference between CSAT and NPS?",
    answer:
      'CSAT is ticket-level satisfaction — "how was this support interaction?". NPS is company-level loyalty — "how likely are you to recommend us?". CSAT moves fast; NPS moves slowly. Use CSAT to measure your support team, NPS to measure your brand.',
  },
  {
    question: 'Is cost per ticket a useful metric?',
    answer:
      'For budgeting conversations with leadership, yes. For operational decisions inside the support team, no. Cost per ticket optimized in isolation tends to cut quality. Always pair with CSAT or reopen rate.',
  },
  {
    question: "What's a good first response time benchmark?",
    answer:
      'Email: under 4 hours during business hours is good. Live chat: under 2 minutes. Social: under 30 minutes. These are median targets — your p95 matters too, because worst-served customers write the worst reviews.',
  },
  {
    question: 'How often should we review these metrics?',
    answer:
      'Daily for backlog and FRT. Weekly for CSAT, resolution time, and SLA compliance. Monthly for NPS, cost per ticket, and retention. Review cadence should match how fast the metric actually moves.',
  },
  {
    question: 'Can I track these in a spreadsheet?',
    answer:
      'You can track volume, backlog, and FRT in a spreadsheet if you have under 50 tickets a week. Past that, you need a help desk that calculates these automatically — manual tracking drifts fast.',
  },
]

function KpiBlock({ kpi }: { kpi: Kpi }) {
  return (
    <div className='not-prose my-6 rounded-xl border border-border bg-card p-5'>
      <h3 className='text-base font-semibold'>{kpi.name}</h3>
      <p className='mt-2 text-sm text-muted-foreground'>{kpi.definition}</p>
      <div className='mt-3 rounded-md bg-muted/50 p-3 font-mono text-xs'>{kpi.formula}</div>
      <div className='mt-3 grid gap-2 text-xs sm:grid-cols-2'>
        <div className='rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5'>
          <p className='font-medium text-emerald-600 dark:text-emerald-400'>Healthy range</p>
          <p className='mt-1 text-muted-foreground'>{kpi.healthy}</p>
        </div>
        <div className='rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5'>
          <p className='font-medium text-amber-600 dark:text-amber-400'>Common gotcha</p>
          <p className='mt-1 text-muted-foreground'>{kpi.gotcha}</p>
        </div>
      </div>
    </div>
  )
}

function ItemListJsonLd() {
  const all = [...speedKpis, ...qualityKpis, ...volumeKpis, ...businessKpis]
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: all.map((k, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      item: {
        '@type': 'DefinedTerm',
        name: k.name,
        description: k.definition,
      },
    })),
  }
  return (
    <script
      type='application/ld+json'
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  )
}

function Sidebar() {
  return (
    <div className='space-y-3'>
      <h2 className='text-sm font-semibold'>Email me the reference</h2>
      <p className='text-xs text-muted-foreground'>
        We&apos;ll send the 12 KPIs straight to your inbox. You can also read them on this page — no
        signup needed.
      </p>
      <LeadCaptureForm
        toolSlug={TOOL_SLUG}
        buttonLabel='Send me the reference'
        successMessage="Thanks — we'll email your copy shortly. The full list is also below on this page."
        disclaimer="We'll email this plus occasional notes on running support better. Unsubscribe any time."
      />
    </div>
  )
}

export default function CustomerSupportKpisPage() {
  return (
    <>
      <ItemListJsonLd />
      <ToolLayout
        breadcrumb={[
          { name: 'Home', href: 'https://auxx.ai' },
          { name: 'Free Tools', href: 'https://auxx.ai/free-tools' },
          { name: 'Customer Support KPIs' },
        ]}
        title='12 Customer Support KPIs That Actually Matter'
        subhead='Metrics, formulas, and benchmarks every small-business support team should know. Free reference, no signup.'
        sidebar={<Sidebar />}
        faqs={faqs}
        relatedTools={[
          {
            title: 'SLA Calculator',
            href: '/free-tools/sla-calculator',
            description: 'How many agents to hit your response SLA.',
          },
          {
            title: 'First Response Time Calculator',
            href: '/free-tools/first-response-time-calculator',
            description: 'Benchmark your FRT against industry norms.',
          },
          {
            title: 'Customer Support Email Templates',
            href: '/free-tools/customer-support-email-templates',
            description: '15 copy-paste templates for common support emails.',
          },
        ]}
        productCta={{
          heading: 'Stop measuring support in spreadsheets.',
          description:
            'Auxx.ai gives you a live dashboard for FRT, CSAT, SLA compliance, and the rest — updated on every ticket.',
          href: '/what-is-auxx-ai',
          label: 'See how Auxx.ai works',
        }}>
        <h2>Pick 4–6, not 12</h2>
        <p>
          This page lists 12 because that is the useful universe of support metrics worth knowing.
          Any single team should pick the 4–6 that match their actual problem — not track all 12 for
          dashboard porn. A team that reviews four metrics weekly outperforms a team that glances at
          twelve quarterly.
        </p>

        <h2>Speed</h2>
        {speedKpis.map((k) => (
          <KpiBlock key={k.name} kpi={k} />
        ))}

        <h2>Quality</h2>
        {qualityKpis.map((k) => (
          <KpiBlock key={k.name} kpi={k} />
        ))}

        <h2>Volume and load</h2>
        {volumeKpis.map((k) => (
          <KpiBlock key={k.name} kpi={k} />
        ))}

        <h2>Business</h2>
        {businessKpis.map((k) => (
          <KpiBlock key={k.name} kpi={k} />
        ))}

        <h2>How to pick which KPIs to track</h2>
        <ul>
          <li>
            <strong>Customers complain about slow replies →</strong> FRT, SLA Compliance,
            Time-to-First-Touch
          </li>
          <li>
            <strong>Customers complain about unhelpful replies →</strong> CSAT, Reopen Rate, FCR
          </li>
          <li>
            <strong>The team feels drowned →</strong> Ticket Volume, Backlog, Cost per Ticket
          </li>
          <li>
            <strong>Leadership wants to justify the team budget →</strong> Cost per Ticket,
            Support-Driven Retention
          </li>
        </ul>

        <h2>Setting targets without making the team miserable</h2>
        <p>
          Targets should come from your last 90 days of data, not from an industry blog. Look at
          what you already do on a good day, set the target around that, and tighten over time.
          Targets pulled out of a benchmark post — with no connection to what the team is already
          capable of — become morale problems within a month.
        </p>
        <p>
          Publish the target internally before tying it to comp. Tying compensation to a brand-new
          metric without a baseline is how you get gaming: ticket-closing sprees at month-end,
          reopen-rate games, CSAT survey gaming. Measure for a quarter before anyone&apos;s bonus
          depends on the number.
        </p>

        <h2>From cheat sheet to dashboard</h2>
        <p>
          The cheat sheet tells you what to measure. A help desk with these KPIs built in tells you
          where you stand, in real time. <Link href='/what-is-auxx-ai'>Auxx.ai</Link> tracks FRT,
          resolution time, SLA compliance, CSAT, and backlog out of the box — so you do not need a
          separate dashboard tool.
        </p>
      </ToolLayout>
    </>
  )
}
