// apps/homepage/src/app/what-is-auxx-ai/page.tsx

import type { Metadata } from 'next'
import Link from 'next/link'
import { config } from '~/lib/config'
import FooterSection from '../_components/main/footer-section'
import Header from '../_components/main/header'

export const metadata: Metadata = {
  title: `What is Auxx.ai? | ${config.shortName}`,
  description: `${config.shortName} is an open-source, AI-powered customer support platform built for Shopify businesses. It connects email, live chat, and Shopify data to automate ticket resolution and streamline support workflows.`,
}

export default function WhatIsAuxxAiPage() {
  return (
    <div id='root' className='relative h-screen overflow-y-auto bg-background'>
      <Header />
      <main className='mt-20'>
        <section className='relative border-foreground/10 border-y'>
          <div className='relative z-10 mx-auto max-w-6xl border-x px-3'>
            <div className='border-x'>
              <div
                aria-hidden
                className='h-3 w-full bg-[repeating-linear-gradient(-45deg,var(--color-black),var(--color-black)_1px,transparent_1px,transparent_4px)] opacity-15'
              />
              <div className='py-16 md:py-24 px-6'>
                <h1 className='mb-8 text-4xl font-bold'>What is Auxx.ai?</h1>

                <div className='prose prose-gray dark:prose-invert max-w-none space-y-8'>
                  <p className='text-lg leading-relaxed'>
                    {config.shortName} is an open-source, AI-powered customer support platform
                    designed for Shopify businesses. It connects your email inboxes, live chat, and
                    Shopify store data into a single workspace where AI agents draft replies,
                    resolve tickets, and escalate issues that need human attention. Built on a
                    modern stack with Next.js, PostgreSQL, and configurable AI providers,{' '}
                    {config.shortName} gives support teams the tools to handle higher ticket volumes
                    without scaling headcount.
                  </p>

                  <section>
                    <h2 className='text-2xl font-semibold'>Key Features</h2>
                    <ul className='space-y-2'>
                      <li>
                        <strong>AI-Powered Ticket Resolution</strong> — AI agents read incoming
                        tickets, pull relevant context from your knowledge base and Shopify data,
                        and draft accurate replies for agent review or automatic sending.
                      </li>
                      <li>
                        <strong>Unified Inbox</strong> — Aggregate email from{' '}
                        <Link href='/platform/messaging' className='underline'>
                          Gmail and Outlook
                        </Link>
                        , plus{' '}
                        <Link href='/platform/live-chat' className='underline'>
                          live chat
                        </Link>
                        , into one shared workspace with collision detection and assignment rules.
                      </li>
                      <li>
                        <strong>Shopify-Native CRM</strong> — Automatically sync customer profiles,
                        order history, and fulfillment status from Shopify. See the full customer
                        picture alongside every ticket. Learn more about the{' '}
                        <Link href='/platform/crm' className='underline'>
                          CRM
                        </Link>
                        .
                      </li>
                      <li>
                        <strong>Knowledge Base</strong> — Create and manage articles that AI uses to
                        generate accurate responses. Supports internal and public-facing content.
                        See{' '}
                        <Link href='/platform/knowledge-base' className='underline'>
                          Knowledge Base
                        </Link>
                        .
                      </li>
                      <li>
                        <strong>Workflow Automation</strong> — Build multi-step{' '}
                        <Link href='/platform/workflow' className='underline'>
                          workflows
                        </Link>{' '}
                        with conditional logic to auto-tag, route, escalate, or respond to tickets
                        based on content, customer attributes, or order data.
                      </li>
                      <li>
                        <strong>Ticketing System</strong> — Full{' '}
                        <Link href='/platform/ticketing' className='underline'>
                          ticketing
                        </Link>{' '}
                        with statuses, priorities, tags, custom fields, SLA tracking, and kanban or
                        table views.
                      </li>
                      <li>
                        <strong>Team Collaboration</strong> — Internal notes, @mentions, collision
                        detection, and role-based access control for support teams.
                      </li>
                      <li>
                        <strong>Custom Fields</strong> — Extend tickets, customers, and other
                        entities with custom field templates to match your business data model.
                      </li>
                    </ul>
                  </section>

                  <section>
                    <h2 className='text-2xl font-semibold'>Who Uses Auxx.ai</h2>
                    <ul className='space-y-2'>
                      <li>
                        <strong>
                          <Link href='/solutions/shopify-stores' className='underline'>
                            Shopify Store Owners
                          </Link>
                        </strong>{' '}
                        — Merchants handling support themselves who want AI to draft replies and
                        reduce time per ticket.
                      </li>
                      <li>
                        <strong>
                          <Link href='/solutions/customer-support-teams' className='underline'>
                            Customer Support Teams
                          </Link>
                        </strong>{' '}
                        — Teams of 2-50 agents managing shared inboxes who need assignment, routing,
                        and AI assistance to hit SLA targets.
                      </li>
                      <li>
                        <strong>
                          <Link href='/solutions/small-business' className='underline'>
                            Small Businesses
                          </Link>
                        </strong>{' '}
                        — Growing businesses that need a support platform but want to avoid the cost
                        and complexity of enterprise tools.
                      </li>
                      <li>
                        <strong>Developers and Self-Hosters</strong> — Teams that want full control
                        over their support infrastructure and customer data through self-hosted
                        deployment.
                      </li>
                    </ul>
                  </section>

                  <section>
                    <h2 className='text-2xl font-semibold'>How It Works</h2>
                    <ol className='list-decimal space-y-3 pl-6'>
                      <li>
                        <strong>Connect your channels</strong> — Link your Gmail or Outlook inbox,
                        enable live chat on your storefront, and connect your Shopify store.
                        Customer data and order history sync automatically.
                      </li>
                      <li>
                        <strong>Set up your knowledge base</strong> — Add articles covering your
                        products, policies, and common questions. The AI uses this content along
                        with Shopify data to generate contextual responses.
                      </li>
                      <li>
                        <strong>Let AI handle tickets</strong> — Incoming messages are analyzed and
                        routed. AI drafts replies for agent review or sends them automatically based
                        on your workflow rules and confidence thresholds.
                      </li>
                    </ol>
                  </section>

                  <section>
                    <h2 className='text-2xl font-semibold'>Integrations</h2>
                    <p>
                      {config.shortName} connects to the tools your business already uses. See the
                      full list on the{' '}
                      <Link href='/platform/integration' className='underline'>
                        integrations page
                      </Link>
                      .
                    </p>
                    <ul className='space-y-2'>
                      <li>
                        <strong>Shopify</strong> — Two-way sync of customers, orders, products, and
                        fulfillment data. Actions like issuing refunds or checking order status
                        directly from the support workspace.
                      </li>
                      <li>
                        <strong>Gmail</strong> — OAuth-based connection for sending and receiving
                        support emails through your existing Gmail account.
                      </li>
                      <li>
                        <strong>Microsoft Outlook</strong> — OAuth-based connection for Outlook and
                        Microsoft 365 email accounts.
                      </li>
                      <li>
                        <strong>AI Providers</strong> — Configurable AI backend supporting OpenAI,
                        Anthropic, and other providers. Bring your own API key or use the managed
                        service.
                      </li>
                    </ul>
                  </section>

                  <section>
                    <h2 className='text-2xl font-semibold'>Open Source</h2>
                    <p>
                      {config.shortName} is released under the <strong>AGPL-3.0 license</strong> and
                      the full source code is available on{' '}
                      <a
                        href={config.links.github}
                        target='_blank'
                        rel='noopener noreferrer'
                        className='underline'>
                        GitHub
                      </a>
                      . You can self-host the entire platform on your own infrastructure using
                      Docker.
                    </p>
                    <p>
                      The self-hosted deployment includes all core features: AI ticket resolution,
                      email integration, Shopify sync, knowledge base, workflows, and team
                      collaboration. There are no artificial feature gates between the open-source
                      and hosted versions.
                    </p>
                    <p>
                      The tech stack includes Next.js, PostgreSQL, Redis, and BullMQ for job
                      processing. Refer to the{' '}
                      <a
                        href={config.links.docs}
                        target='_blank'
                        rel='noopener noreferrer'
                        className='underline'>
                        documentation
                      </a>{' '}
                      for setup instructions.
                    </p>
                  </section>

                  <section>
                    <h2 className='text-2xl font-semibold'>Pricing</h2>
                    <p>
                      {config.shortName} offers a free tier for small teams and usage-based paid
                      plans that scale with your ticket volume. The hosted version includes managed
                      infrastructure, automatic updates, and priority support.
                    </p>
                    <p>
                      Self-hosting is free under the AGPL-3.0 license. See the{' '}
                      <Link href='/pricing' className='underline'>
                        pricing page
                      </Link>{' '}
                      for current plan details and feature comparisons.
                    </p>
                  </section>

                  <section>
                    <h2 className='text-2xl font-semibold'>How Auxx.ai Compares</h2>
                    <p>
                      {config.shortName} occupies a different position than most customer support
                      platforms. Here is how it differs from commonly compared tools:
                    </p>
                    <ul className='space-y-2'>
                      <li>
                        <strong>vs. Gorgias</strong> — Gorgias is a closed-source, Shopify-focused
                        helpdesk with per-ticket pricing. {config.shortName} provides similar
                        Shopify integration and AI capabilities but is open-source, self-hostable,
                        and uses seat-based pricing rather than per-ticket billing.
                      </li>
                      <li>
                        <strong>vs. Zendesk</strong> — Zendesk is a general-purpose enterprise
                        support platform. {config.shortName} is purpose-built for Shopify with
                        deeper e-commerce data integration, AI-first ticket handling, and
                        significantly lower complexity for small-to-medium teams.
                      </li>
                      <li>
                        <strong>vs. Front</strong> — Front is a shared inbox tool designed for team
                        email collaboration. {config.shortName} adds native Shopify data, AI-powered
                        response generation, workflow automation, and a built-in knowledge base on
                        top of shared inbox functionality.
                      </li>
                    </ul>
                    <p>
                      For a side-by-side look at the broader market, see our{' '}
                      <Link
                        href='/blog/best-ai-customer-support-software-small-business'
                        className='underline'>
                        roundup of the best AI customer support software for small businesses
                      </Link>
                      .
                    </p>
                  </section>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
      <FooterSection />
    </div>
  )
}
