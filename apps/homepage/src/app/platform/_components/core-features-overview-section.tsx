// apps/web/src/app/(website)/features/_components/sections/core-features-overview-section.tsx
import { Check, Database, Mail, Shield, Sparkles, Workflow } from 'lucide-react'
import { Card } from '~/components/ui/card'

// Represents the primary hero cards that headline the core features grid.
const primaryFeatureCards = [
  {
    id: 'ai-responses',
    title: 'Next-Gen AI That Understands Context',
    subtitle: 'Auxx.ai proprietary models fine-tuned for e-commerce support.',
    points: [
      'GPT-4 and GPT-4o powered response generation',
      'Multi-language coverage across 15+ locales',
      'Sentiment analysis with tonal adjustments',
      'Intent recognition tied to automation playbooks',
      'Conversation memory across entire customer history',
    ],
    illustrationCaption:
      'Live message intelligence: detect intent, sentiment, and policy gaps in under a second.',
  },
  {
    id: 'shopify-integration',
    title: 'Native Shopify Integration Like No Other',
    subtitle: 'Direct APIs into orders, products, fulfillments, and loyalty data.',
    points: [
      'Real-time order and fulfillment tracking',
      'Inventory checks with backorder warnings',
      'Customer lifetime value surfaced inline',
      'Refund, exchange, and warranty workflows',
      'Personalized product and cross-sell suggestions',
    ],
    illustrationCaption:
      'Bi-directional sync keeps Shopify the single source of truth for every support decision.',
  },
]

// Captures the supporting feature cards for the asymmetrical core features grid.
const supportingFeatureCards = [
  {
    title: 'Smart Inbox Management',
    description:
      'Auto-categorization, VIP routing, and noise reduction keep agents focused on what matters.',
    icon: Mail,
  },
  {
    title: 'Automation Guardrails',
    description:
      'Policy-aware approvals, escalation paths, and auto-pauses ensure automation remains safe.',
    icon: Workflow,
  },
  {
    title: 'Data Unification',
    description:
      'Connect CRMs, loyalty tools, shipping providers, and ERPs for full context in every reply.',
    icon: Database,
  },
  {
    title: 'Compliance First',
    description:
      'PII redaction, access controls, and immutable audit logs come standard with every workspace.',
    icon: Shield,
  },
]

// Renders the core features bento grid highlighting the AI engine and Shopify integration pillars.
export function CoreFeaturesOverviewSection() {
  return (
    <section id='ai-responses' className='relative border-foreground/10 border-b'>
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3'>
        <div className='border-x'>
          <div
            aria-hidden
            className='h-3 w-full bg-[repeating-linear-gradient(-45deg,var(--color-foreground),var(--color-foreground)_1px,transparent_1px,transparent_4px)] opacity-5'
          />
          <div className='w-full px-6 py-24'>
            <div className='mb-12 flex flex-col gap-4'>
              <span className='text-sm font-semibold text-indigo-500'>Core platform</span>
              <h2 className='text-pretty text-3xl font-semibold sm:text-4xl'>
                Built to automate support without compromises
              </h2>
              <p className='text-muted-foreground max-w-3xl text-base'>
                Auxx.ai brings together best-in-class AI, Shopify-native data access, and secure
                automation guardrails so you never have to choose between speed and quality.
              </p>
            </div>
            <div className='grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_0.9fr]'>
              {primaryFeatureCards.map((card) => (
                <Card
                  key={card.id}
                  className='border-border/60 relative overflow-hidden rounded-3xl border p-8 shadow-sm'>
                  <div className='flex flex-col gap-6'>
                    <div className='space-y-4'>
                      <h3 className='text-foreground text-2xl font-semibold'>{card.title}</h3>
                      <p className='text-muted-foreground text-base'>{card.subtitle}</p>
                    </div>
                    <ul className='grid gap-3'>
                      {card.points.map((point) => (
                        <li key={point} className='flex items-start gap-3'>
                          <Check className='mt-1 h-4 w-4 text-indigo-500' />
                          <span className='text-sm text-muted-foreground'>{point}</span>
                        </li>
                      ))}
                    </ul>
                    <div className='border-border/50 bg-muted/70 rounded-2xl border p-4 text-sm text-muted-foreground'>
                      {card.illustrationCaption}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
            <div className='mt-6 grid grid-cols-1 gap-4 md:grid-cols-2'>
              {supportingFeatureCards.map((card) => {
                const Icon = card.icon
                return (
                  <Card
                    key={card.title}
                    className='border-border/60 flex flex-col gap-4 rounded-2xl border p-6'>
                    <Icon className='h-6 w-6 text-indigo-500' />
                    <div className='text-foreground text-lg font-semibold'>{card.title}</div>
                    <p className='text-muted-foreground text-sm'>{card.description}</p>
                  </Card>
                )
              })}
            </div>
            <div className='mt-6 rounded-2xl border border-dashed border-primary/30 bg-primary/5 p-6 text-sm text-muted-foreground'>
              Auxx.ai bakes personalization, policy controls, and analytics into the core platform.
              Every automation is tested against historical tickets before go-live, meaning you
              launch with confidence on day one.
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
