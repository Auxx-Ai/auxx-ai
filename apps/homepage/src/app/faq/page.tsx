// apps/homepage/src/app/faq/page.tsx

import type { Metadata } from 'next'
import { config } from '~/lib/config'
import FooterSection from '../_components/main/footer-section'
import Header from '../_components/main/header'
import { FaqAccordion, type FaqItem } from './_components/faq-accordion'

const faqs: FaqItem[] = [
  {
    question: 'What is Auxx.ai?',
    answer:
      'Auxx.ai is an open-source, AI-powered customer support platform built for Shopify businesses. It connects your email, Shopify store data, and a knowledge base so AI can draft accurate replies to support tickets. The goal is to reduce response times and handle repetitive questions automatically.',
  },
  {
    question: 'Is Auxx.ai free?',
    answer:
      'Auxx.ai offers a free tier that includes core features like AI-assisted ticket replies and basic integrations. Paid plans unlock higher volumes, additional AI models, and advanced workflow automation. Because the project is open source, you can also self-host at no licensing cost.',
  },
  {
    question: 'Does Auxx.ai work with Shopify?',
    answer:
      'Yes. Auxx.ai integrates directly with Shopify to pull in order data, customer profiles, and product information. This context is used by the AI when drafting replies, so answers reference the correct order status, tracking numbers, and product details.',
  },
  {
    question: 'What AI models does Auxx.ai support?',
    answer:
      'Auxx.ai supports multiple AI providers including OpenAI (GPT-4o, GPT-4o-mini), Anthropic (Claude), and Google (Gemini). You can choose which model to use per workflow or let the system select the best option based on the task.',
  },
  {
    question: 'Can I self-host Auxx.ai?',
    answer:
      'Yes. Auxx.ai is fully open source and designed to be self-hosted. The stack runs on Docker with PostgreSQL and Redis as dependencies. Deployment guides are available in the documentation for AWS, Railway, and other platforms.',
  },
  {
    question: 'How does Auxx.ai compare to Gorgias?',
    answer:
      'Unlike Gorgias, Auxx.ai is open source with no per-ticket pricing. It offers comparable AI-powered ticket handling, Shopify integration, and multi-channel support. The main differences are transparent pricing, full data ownership, and the ability to self-host and customize the platform.',
  },
  {
    question: 'Does Auxx.ai support Gmail and Outlook?',
    answer:
      'Yes. Auxx.ai supports both Gmail and Outlook (Microsoft 365) as email channels. You can connect multiple mailboxes, and incoming emails are automatically converted into support tickets with full thread tracking.',
  },
  {
    question: "What is Auxx.ai's pricing?",
    answer:
      'Auxx.ai offers a free tier for small teams getting started. Paid plans scale based on ticket volume and feature access, with no per-agent seat fees. Self-hosted deployments have no licensing cost. Visit the pricing page for current plan details.',
  },
  {
    question: 'Is Auxx.ai open source?',
    answer:
      'Yes. The full source code is available on GitHub. Auxx.ai is built with Next.js, tRPC, Drizzle ORM, and PostgreSQL. Contributions are welcome, and the project is actively maintained.',
  },
  {
    question: 'How do I set up Auxx.ai?',
    answer:
      'Sign up at auxx.ai, connect your Shopify store and email account, then configure your knowledge base with common support topics. The AI begins drafting replies immediately based on your store data and knowledge base articles. Setup typically takes under 15 minutes.',
  },
]

export const metadata: Metadata = {
  title: `Frequently Asked Questions | ${config.shortName}`,
  description:
    'Find answers to common questions about Auxx.ai, the open-source AI-powered customer support platform for Shopify. Learn about pricing, integrations, self-hosting, and more.',
}

export default function FaqPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  }

  return (
    <div id='root' className='relative overflow-y-auto h-screen bg-background'>
      <Header />
      <main className='mx-auto max-w-3xl px-6 py-24 sm:py-32'>
        <script
          type='application/ld+json'
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <h1 className='text-3xl font-bold tracking-tight sm:text-4xl'>
          Frequently Asked Questions
        </h1>
        <p className='text-muted-foreground mt-4 text-lg'>
          Common questions about {config.shortName} and how it works.
        </p>
        <div className='mt-10'>
          <FaqAccordion items={faqs} />
        </div>
      </main>
      <FooterSection />
    </div>
  )
}
