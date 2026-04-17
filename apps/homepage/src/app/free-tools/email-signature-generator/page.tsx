// apps/homepage/src/app/free-tools/email-signature-generator/page.tsx

import { getHomepageUrl } from '@auxx/config/client'
import type { Metadata } from 'next'
import Link from 'next/link'
import { ToolLayout } from '../_components/tool-layout'
import { SignatureBuilder } from './_components/signature-builder'

const CANONICAL = getHomepageUrl('/free-tools/email-signature-generator')

export const metadata: Metadata = {
  title: 'Free Email Signature Generator — Gmail, Outlook, Apple Mail | Auxx.ai',
  description:
    'Free email signature generator. Build a professional HTML signature in 60 seconds. Copy straight into Gmail, Outlook, or Apple Mail. No signup.',
  alternates: { canonical: CANONICAL },
  openGraph: {
    title: 'Free Email Signature Generator',
    description: 'Build a professional email signature in 60 seconds.',
    url: CANONICAL,
    type: 'website',
  },
}

const faqs = [
  {
    question: 'Is this email signature generator actually free?',
    answer:
      'Yes. Build as many signatures as you want, copy them into any email client, no account needed.',
  },
  {
    question: 'Will the signature work in Gmail, Outlook, and Apple Mail?',
    answer:
      'Yes. Signatures are rendered with inline HTML tables — the only reliable way to get consistent rendering across all three. Instructions for each are below the preview.',
  },
  {
    question: 'Can I add a logo or headshot?',
    answer:
      'Yes. Host the image somewhere public (your website, Imgur, Cloudinary) and paste the URL into the Avatar URL or Logo URL field. Email clients will not let you upload images into signatures directly — they need to be linked.',
  },
  {
    question: 'Why are my fonts different after I paste the signature?',
    answer:
      'Email clients only render a small set of system fonts reliably. The generator uses email-safe fonts only (Arial, Helvetica, Georgia, Verdana, Tahoma) — picking a web font like Inter or Roboto will fall back in most inboxes.',
  },
  {
    question: 'How do I edit the signature later?',
    answer:
      'Come back to this page with the same inputs. The generator does not store anything — your inputs live only in your browser while you are on the page.',
  },
  {
    question: 'Does it work on mobile email apps?',
    answer:
      'The HTML renders in Gmail, Outlook, and Apple Mail mobile apps. Mobile clients do not let you edit signatures from the phone in most cases — set it up on desktop and it syncs.',
  },
]

function SoftwareAppJsonLd() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Email Signature Generator',
    applicationCategory: 'UtilitiesApplication',
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

export default function EmailSignatureGeneratorPage() {
  return (
    <>
      <SoftwareAppJsonLd />
      <ToolLayout
        breadcrumb={[
          { name: 'Home', href: 'https://auxx.ai' },
          { name: 'Free Tools', href: 'https://auxx.ai/free-tools' },
          { name: 'Email Signature Generator' },
        ]}
        title='Free Email Signature Generator'
        subhead='Build a professional email signature in 60 seconds. Copy the HTML into Gmail, Outlook, or Apple Mail. Free, no signup.'
        faqs={faqs}
        relatedTools={[
          {
            title: 'Customer Support Email Templates',
            href: '/free-tools/customer-support-email-templates',
            description: '15 copy-paste templates for common support emails.',
          },
          {
            title: 'SLA Calculator',
            href: '/free-tools/sla-calculator',
            description: 'Work out how many agents you need to hit your SLA.',
          },
          {
            title: 'Customer Support KPI Cheat Sheet',
            href: '/free-tools/customer-support-kpis',
            description: '12 metrics every small support team should track.',
          },
        ]}
        productCta={{
          heading: 'Need shared email signatures for your team?',
          description:
            'Auxx.ai gives every agent the same branded signature across every reply, with customer context one click away.',
          href: '/what-is-auxx-ai',
          label: 'See how Auxx.ai works',
        }}>
        <SignatureBuilder />

        <h2>What makes a good email signature</h2>
        <ul>
          <li>Keep it under 4 lines — anyone using a mobile email client will thank you</li>
          <li>Include one clear primary contact method, not all of them</li>
          <li>Skip animated GIFs, inspirational quotes, and disclaimers longer than the email</li>
          <li>Stick to email-safe fonts — Arial, Helvetica, Georgia, Verdana, Tahoma</li>
          <li>
            Do not use an image for the text of your signature — bad for accessibility and dark mode
          </li>
          <li>Link text once; do not over-link or the signature looks spammy</li>
        </ul>

        <h2>Email signature best practices for small businesses</h2>
        <p>
          For a small team, consistency across the team matters more than each individual signature
          being unique. Everyone gets the same template, the same color, the same font — swap only
          the name, title, and contact info. That is how a small team looks like a company instead
          of five people using five different email clients.
        </p>
        <p>
          For customer-facing roles — support, sales, customer success — keep the signature minimal
          and one click from a reply path (email or phone). The signature is not the marketing; the
          reply is.
        </p>

        <h2>Email signatures and brand consistency</h2>
        <p>
          If your team is sending emails from shared inboxes — support@ or hello@ — the signature is
          the only place the customer sees who is actually replying. Keep it consistent across the
          team and you look like a company. Keep it chaotic and you look like a group chat.
        </p>
        <p>
          <Link href='/what-is-auxx-ai'>Auxx.ai</Link> lets teams set canned signatures per agent
          that pull from a shared brand palette, so support emails look the same whether Alex or Sam
          sent them.
        </p>
      </ToolLayout>
    </>
  )
}
