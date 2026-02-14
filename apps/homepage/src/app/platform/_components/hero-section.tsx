// apps/web/src/app/(website)/features/_components/sections/hero-section.tsx
'use client'

import { ChartSpline, ShieldCheck, Sparkles, Workflow, Zap } from 'lucide-react'
import Link from 'next/link'
import React from 'react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { cn } from '~/lib/utils'

// Defines the hero category navigation items for the features landing page.
const heroCategories = [
  {
    id: 'ai-engine',
    label: 'AI Engine',
    metricLabel: 'Avg. response time',
    metricValue: '0.3s',
    blurb: 'Context-aware answers powered by proprietary fine-tuned models.',
    highlight: 'Understands customer history and tone to craft thoughtful replies instantly.',
  },
  {
    id: 'email-management',
    label: 'Email Management',
    metricLabel: 'Tickets auto-triaged',
    metricValue: '82%',
    blurb: 'Keep inboxes prioritized without lifting a finger.',
    highlight:
      'Auto-tags requests, elevates VIP customers, and drafts responses grounded in policy.',
  },
  {
    id: 'shopify-integration',
    label: 'Shopify Integration',
    metricLabel: 'Order lookups',
    metricValue: '6.5k / min',
    blurb: 'Native connection to storefront, orders, products, and fulfillment.',
    highlight: 'Instantly fetch tracking, process refunds, and recommend replacement products.',
  },
  {
    id: 'analytics',
    label: 'Analytics',
    metricLabel: 'Automation lift',
    metricValue: '71%',
    blurb: 'Quantify productivity gains and uncover coaching opportunities.',
    highlight: 'Interactive dashboards spotlight bottlenecks, CSAT, and savings per channel.',
  },
] satisfies Array<{
  id: string
  label: string
  metricLabel: string
  metricValue: string
  blurb: string
  highlight: string
}>

// Lists quick anchor links for jumping to feature sections within the page.
const quickAnchors = [
  { id: 'ai-responses', label: 'AI Engine' },
  { id: 'email-automation', label: 'Email Management' },
  { id: 'shopify-integration', label: 'Shopify Integration' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'team-tools', label: 'Team Tools' },
  { id: 'customization', label: 'Customization' },
]

// Describes headline highlight bullets for visual reinforcement in the hero section.
const heroHighlights = [
  {
    icon: Sparkles,
    title: '95% accuracy on first reply',
    description: 'Continuously learning models trained on millions of e-commerce interactions.',
  },
  {
    icon: Workflow,
    title: 'Workflow aware automation',
    description: 'From refund approvals to loyalty perks, every decision respects business rules.',
  },
  {
    icon: ShieldCheck,
    title: 'Compliance built in',
    description: 'SOC 2 Type II readiness, redaction, and granular audit trails by default.',
  },
]

// Renders the hero section for the features page with interactive category navigation.
export function FeaturesHeroSection() {
  const [activeCategory, setActiveCategory] = React.useState(heroCategories[0])

  return (
    <section className='border-b'>
      <div className='relative mx-auto flex w-full max-w-6xl flex-col gap-12 px-6 pb-24 pt-32'>
        <div className='absolute inset-x-0 -z-10 h-[480px] bg-gradient-to-b from-primary/10 via-transparent to-background blur-3xl' />
        <div className='flex flex-col gap-6 text-center'>
          <Badge
            variant='outline'
            className='mx-auto w-fit px-3 py-1 text-xs uppercase tracking-wide'>
            Feature deep dive
          </Badge>
          <h1 className='text-foreground text-pretty text-4xl font-semibold sm:text-5xl md:text-6xl'>
            Every Feature You Need to Deliver Exceptional AI-Powered Support
          </h1>
          <p className='text-muted-foreground mx-auto max-w-3xl text-lg'>
            From intelligent response generation to deep Shopify integration, Auxx.ai provides a
            complete toolkit for automating customer service while maintaining the human touch.
          </p>
          <div className='flex flex-wrap justify-center gap-3'>
            {quickAnchors.map((anchor) => (
              <Button key={anchor.id} asChild variant='outline' size='sm' className='rounded-full'>
                <Link href={`#${anchor.id}`}>{anchor.label}</Link>
              </Button>
            ))}
          </div>
        </div>

        <div className='grid grid-cols-1 gap-10 lg:grid-cols-[280px_1fr]'>
          <nav
            aria-label='Feature categories'
            className='flex snap-x snap-mandatory gap-3 overflow-x-auto lg:flex-col lg:overflow-visible'>
            {heroCategories.map((category) => (
              <button
                key={category.id}
                type='button'
                onClick={() => setActiveCategory(category)}
                data-active={activeCategory.id === category.id}
                className={cn(
                  'border-border/60 bg-card/40 hover:border-primary/30 hover:bg-primary/5 data-[active=true]:border-primary data-[active=true]:bg-primary/10 flex min-w-[180px] flex-1 flex-col gap-1 rounded-2xl border p-4 text-left transition'
                )}>
                <span className='text-sm font-medium text-foreground'>{category.label}</span>
                <span className='text-xs text-muted-foreground'>{category.blurb}</span>
                <span className='mt-2 flex items-baseline gap-1'>
                  <span className='text-2xl font-semibold text-indigo-500'>
                    {category.metricValue}
                  </span>
                  <span className='text-xs text-muted-foreground'>{category.metricLabel}</span>
                </span>
              </button>
            ))}
          </nav>

          <div className='relative flex flex-col gap-8 rounded-3xl border border-border/60 bg-background/70 p-8 shadow-xl'>
            <div className='grid gap-6 md:grid-cols-[1.1fr_0.9fr]'>
              <div className='space-y-6 text-left'>
                <div className='space-y-3'>
                  <h2 className='text-foreground text-3xl font-semibold'>{activeCategory.label}</h2>
                  <p className='text-muted-foreground text-base'>{activeCategory.highlight}</p>
                </div>
                <div className='grid gap-3 sm:grid-cols-2'>
                  {heroHighlights.map((highlight) => {
                    const Icon = highlight.icon
                    return (
                      <div
                        key={highlight.title}
                        className='border-border/60 bg-muted/60 rounded-2xl border p-4'>
                        <Icon className='mb-3 h-5 w-5 text-indigo-500' />
                        <div className='text-sm font-medium text-foreground'>{highlight.title}</div>
                        <p className='text-muted-foreground mt-1 text-xs'>
                          {highlight.description}
                        </p>
                      </div>
                    )
                  })}
                </div>
                <div className='flex flex-wrap items-center gap-3'>
                  <Button size='lg'>Start free trial</Button>
                  <Button variant='outline' size='lg' className='gap-2'>
                    <Zap className='h-4 w-4' />
                    Launch product tour
                  </Button>
                </div>
              </div>
              <div className='relative overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-primary/10 via-background to-muted/60 p-6'>
                <div className='text-sm text-muted-foreground uppercase tracking-[0.2em]'>
                  Live preview
                </div>
                <div className='mt-4 space-y-4'>
                  <div className='rounded-2xl border border-dashed border-primary/30 bg-primary/10 p-4'>
                    <p className='text-muted-foreground text-xs'>Automation playbook</p>
                    <p className='text-foreground mt-2 text-lg font-semibold'>
                      Policy aligned response
                    </p>
                    <p className='text-muted-foreground mt-2 text-sm'>
                      Auxx.ai auto-applies your macros, empathy guidelines, and refund thresholds
                      before drafting replies.
                    </p>
                  </div>
                  <div className='rounded-2xl border border-border/60 bg-card/80 p-4 shadow-md'>
                    <div className='flex items-center justify-between'>
                      <span className='text-xs font-medium text-muted-foreground'>Confidence</span>
                      <span className='text-sm font-semibold text-indigo-500'>98%</span>
                    </div>
                    <div className='mt-3 space-y-2 text-xs'>
                      <div className='flex items-center justify-between rounded-lg bg-muted/80 px-3 py-2'>
                        <span className='text-muted-foreground'>Tone</span>
                        <span className='text-foreground font-medium'>On-brand</span>
                      </div>
                      <div className='flex items-center justify-between rounded-lg bg-muted/80 px-3 py-2'>
                        <span className='text-muted-foreground'>Policy checks</span>
                        <span className='text-foreground font-medium'>Passed</span>
                      </div>
                      <div className='flex items-center justify-between rounded-lg bg-muted/80 px-3 py-2'>
                        <span className='text-muted-foreground'>Escalation status</span>
                        <span className='text-foreground font-medium'>Not required</span>
                      </div>
                    </div>
                  </div>
                  <div className='border-border/60 bg-muted/40 flex items-center justify-between rounded-2xl border p-4'>
                    <div>
                      <p className='text-xs text-muted-foreground'>SSO • SOC2 • GDPR</p>
                      <p className='text-sm font-semibold text-foreground'>
                        Enterprise-grade security
                      </p>
                    </div>
                    <ChartSpline className='h-10 w-10 text-indigo-500' />
                  </div>
                </div>
              </div>
            </div>

            <div className='grid gap-4 text-left text-xs text-muted-foreground sm:grid-cols-4'>
              <div>
                <p className='font-semibold text-foreground'>Feature exploration rate</p>
                <p>60%+ scroll depth tracked by default.</p>
              </div>
              <div>
                <p className='font-semibold text-foreground'>Demo requests</p>
                <p>Target 8-10% conversion with embedded tour.</p>
              </div>
              <div>
                <p className='font-semibold text-foreground'>Documentation clicks</p>
                <p>Deep links surface relevant guides contextually.</p>
              </div>
              <div>
                <p className='font-semibold text-foreground'>Time on page</p>
                <p>Optimized for 4-5 minute dwell with micro-interactions.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
