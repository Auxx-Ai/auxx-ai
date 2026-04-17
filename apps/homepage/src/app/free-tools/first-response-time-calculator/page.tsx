// apps/homepage/src/app/free-tools/first-response-time-calculator/page.tsx

import { getHomepageUrl } from '@auxx/config/client'
import type { Metadata } from 'next'
import Link from 'next/link'
import { ToolLayout } from '../_components/tool-layout'
import { FrtCalculator } from './_components/frt-calculator'

const CANONICAL = getHomepageUrl('/free-tools/first-response-time-calculator')

export const metadata: Metadata = {
  title: 'First Response Time Calculator — Paste Tickets, See Your FRT | Auxx.ai',
  description:
    'Free first response time calculator. Paste your ticket timestamps or enter your averages to see your median, p95, and channel benchmarks.',
  alternates: { canonical: CANONICAL },
  openGraph: {
    title: 'First Response Time Calculator',
    description: 'Calculate your FRT and compare to industry benchmarks.',
    url: CANONICAL,
    type: 'website',
  },
}

const faqs = [
  {
    question: 'What is a good first response time?',
    answer:
      'For email, under 4 hours is good, under 1 hour is excellent. For live chat, under 2 minutes is standard. For social, under 30 minutes is excellent. These are median-based benchmarks — what your worst-served customers see matters more than the average.',
  },
  {
    question: 'Does first response time include auto-replies?',
    answer:
      'It should not. An auto-ack reassures the customer a message was received, but it does not count as a real reply. Measure FRT to the first human response for a meaningful number.',
  },
  {
    question: 'How is first response time different from resolution time?',
    answer:
      'FRT is the clock until the first human reply. Resolution time is the clock until the ticket closes. A fast first reply followed by a slow resolution is better than the opposite, but not by much — track both.',
  },
  {
    question: 'Should I measure FRT by ticket, by customer, or by conversation?',
    answer:
      'By ticket for operational tracking. By customer if you want to see whether specific customers are getting worse service. Most help desks default to by-ticket.',
  },
  {
    question: 'How do I reduce my first response time without hiring more agents?',
    answer:
      'Pre-staff the first hour of your support window — most ticket volume spikes in that window. Build saved replies for your top 5 ticket types. Route tickets to a dedicated first-responder before they go to the specialist queue.',
  },
  {
    question: 'Why are my median and mean so different?',
    answer:
      'Support data is right-skewed. A handful of tickets sit in the queue over a weekend and pull the mean up. Median filters those out and is closer to what a typical customer experiences. Use median for daily tracking, p95 for worst-case visibility.',
  },
]

function SoftwareAppJsonLd() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'First Response Time Calculator',
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

export default function FirstResponseTimeCalculatorPage() {
  return (
    <>
      <SoftwareAppJsonLd />
      <ToolLayout
        breadcrumb={[
          { name: 'Home', href: 'https://auxx.ai' },
          { name: 'Free Tools', href: 'https://auxx.ai/free-tools' },
          { name: 'First Response Time Calculator' },
        ]}
        title='First Response Time Calculator'
        subhead='Paste your ticket timestamps or enter your averages. See your mean, median, and p95 response times vs. industry benchmarks.'
        faqs={faqs}
        relatedTools={[
          {
            title: 'SLA Calculator',
            href: '/free-tools/sla-calculator',
            description: 'Figure out how many agents you need to hit your SLA.',
          },
          {
            title: 'Customer Support KPI Cheat Sheet',
            href: '/free-tools/customer-support-kpis',
            description: '12 metrics every small support team should track.',
          },
          {
            title: 'Customer Support Email Templates',
            href: '/free-tools/customer-support-email-templates',
            description: '15 copy-paste templates to speed up your replies.',
          },
        ]}
        productCta={{
          heading: 'Track first response time live, not once a quarter.',
          description:
            'Auxx.ai puts FRT, resolution time, and SLA compliance in one dashboard — updated on every ticket.',
          href: '/what-is-auxx-ai',
          label: 'See how Auxx.ai works',
        }}>
        <FrtCalculator />

        <h2>What is first response time?</h2>
        <p>
          First response time (FRT) is the elapsed time between when a customer sends a message and
          when they get a human reply. Not an auto-acknowledgement. Not a ticket-created webhook. A
          real human response.
        </p>
        <p>
          It matters because it is the single support metric customers feel most directly.
          Resolution time matters for closure. CSAT matters for sentiment. FRT matters for whether a
          customer thinks anyone is listening.
        </p>

        <h2>Mean vs. median vs. p95</h2>
        <h3>Mean</h3>
        <p>
          The average. Gets pulled up by a handful of tickets that sat in the queue over a weekend.
          Useful as a headline number, misleading if you use it alone.
        </p>
        <h3>Median</h3>
        <p>
          The middle value. Half your tickets were answered faster; half were slower. This is the
          honest "typical customer" number and the one to track day-to-day.
        </p>
        <h3>P95</h3>
        <p>
          95% of your tickets were answered within this time; 5% were slower. This is the
          worst-case-experience number. A great median with a bad p95 means most customers are happy
          but a small group is getting ignored — and they are the ones writing reviews.
        </p>

        <h2>First response time benchmarks by channel</h2>
        <div className='not-prose overflow-x-auto'>
          <table className='w-full border-collapse text-sm'>
            <thead>
              <tr className='border-b border-border'>
                <th className='py-2 pr-3 text-left font-medium'>Channel</th>
                <th className='py-2 pr-3 text-left font-medium'>Excellent</th>
                <th className='py-2 pr-3 text-left font-medium'>Good</th>
                <th className='py-2 pr-3 text-left font-medium'>Average</th>
                <th className='py-2 text-left font-medium'>Slow</th>
              </tr>
            </thead>
            <tbody className='text-muted-foreground'>
              <tr className='border-b border-border'>
                <td className='py-2 pr-3 font-medium text-foreground'>Email</td>
                <td className='py-2 pr-3'>&lt; 1 hr</td>
                <td className='py-2 pr-3'>1–4 hr</td>
                <td className='py-2 pr-3'>4–12 hr</td>
                <td className='py-2'>&gt; 12 hr</td>
              </tr>
              <tr className='border-b border-border'>
                <td className='py-2 pr-3 font-medium text-foreground'>Live chat</td>
                <td className='py-2 pr-3'>&lt; 1 min</td>
                <td className='py-2 pr-3'>1–5 min</td>
                <td className='py-2 pr-3'>5–15 min</td>
                <td className='py-2'>&gt; 15 min</td>
              </tr>
              <tr>
                <td className='py-2 pr-3 font-medium text-foreground'>Social</td>
                <td className='py-2 pr-3'>&lt; 30 min</td>
                <td className='py-2 pr-3'>30 min – 2 hr</td>
                <td className='py-2 pr-3'>2–12 hr</td>
                <td className='py-2'>&gt; 12 hr</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2>What moves first response time</h2>
        <ul>
          <li>
            Coverage during peak hours — most teams are understaffed in the first hour of the day
          </li>
          <li>A triage step before tickets hit the specialist queue</li>
          <li>Saved replies for the top 5 question types — usually 50% of all tickets</li>
          <li>Inbox routing rules so urgent tickets surface first</li>
          <li>A first-responder-on-call rotation, especially for small teams</li>
        </ul>

        <h2>First response time is not everything</h2>
        <p>
          FRT is a leading indicator; resolution time and CSAT are lagging indicators. A 30-second
          "got it!" followed by three days of silence is worse than a two-hour real reply. Teams
          that optimize only for FRT end up sending fast, low-quality replies that kick the
          conversation further down the queue.
        </p>

        <h2>From calculator to dashboard</h2>
        <p>
          The calculator runs once. A help desk with real-time FRT tracking keeps you honest every
          day. <Link href='/what-is-auxx-ai'>Auxx.ai</Link> shows FRT live on every ticket and by
          channel, so you can spot a problem the same hour it starts — not the week after.
        </p>
      </ToolLayout>
    </>
  )
}
