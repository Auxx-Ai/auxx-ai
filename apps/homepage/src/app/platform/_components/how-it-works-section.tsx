// apps/web/src/app/(website)/features/_components/sections/how-it-works-section.tsx

import { ArrowRight, ClipboardCheck, PlayCircle, Settings, Sparkles } from 'lucide-react'
import { Badge } from '~/components/ui/badge'
import { Card } from '~/components/ui/card'

// Outlines the sequential steps for adopting Auxx.ai highlighted in the walkthrough.
const howItWorksSteps = [
  {
    title: 'Connect your channels',
    description:
      'Plug in Shopify, Gmail, Outlook, Slack, and your helpdesk with guided setup wizards.',
    icon: Settings,
  },
  {
    title: 'Import context & policies',
    description:
      'Upload macros, policy docs, and tone guidelines. Auxx.ai converts them into structured rules.',
    icon: ClipboardCheck,
  },
  {
    title: 'Train with historical tickets',
    description:
      'Replay resolved conversations to fine tune the AI and validate guardrails in a sandbox.',
    icon: PlayCircle,
  },
  {
    title: 'Launch with continuous learning',
    description:
      'Roll out automation gradually, monitor analytics, and iterate with agent feedback loops.',
    icon: Sparkles,
  },
]

// Renders the implementation timeline showing how Auxx.ai is adopted.
export function HowItWorksSection() {
  return (
    <section className='relative border-foreground/10 border-b'>
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3'>
        <div className='border-x'>
          <div
            aria-hidden
            className='h-3 w-full bg-[repeating-linear-gradient(-45deg,var(--color-foreground),var(--color-foreground)_1px,transparent_1px,transparent_4px)] opacity-5'
          />
          <div className='w-full px-6 py-24'>
            <div className='grid gap-8 lg:grid-cols-[0.9fr_1.1fr]'>
              <div className='space-y-4'>
                <Badge variant='outline' className='w-fit'>
                  How it works
                </Badge>
                <h2 className='text-pretty text-3xl font-semibold sm:text-4xl'>
                  Launch in days, not months
                </h2>
                <p className='text-muted-foreground text-base'>
                  Auxx.ai guides your team through a proven rollout plan. Configure core automations
                  in under a week and scale to every channel with confidence.
                </p>
                <div className='flex flex-wrap gap-3 text-xs text-muted-foreground'>
                  <span className='rounded-full border border-border/60 px-3 py-1'>
                    No code setup
                  </span>
                  <span className='rounded-full border border-border/60 px-3 py-1'>
                    Dedicated onboarding
                  </span>
                  <span className='rounded-full border border-border/60 px-3 py-1'>
                    Migration support
                  </span>
                </div>
              </div>
              <div className='grid gap-4'>
                {howItWorksSteps.map((step, index) => {
                  const Icon = step.icon
                  return (
                    <Card
                      key={step.title}
                      className='border-border/60 flex items-center gap-4 rounded-3xl border p-6'>
                      <div className='flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/40 bg-primary/10 text-indigo-500'>
                        <Icon className='h-5 w-5' />
                      </div>
                      <div className='flex-1'>
                        <div className='flex items-center justify-between'>
                          <div className='text-sm font-semibold text-foreground'>
                            <span className='mr-2 text-indigo-500'>
                              {String(index + 1).padStart(2, '0')}
                            </span>
                            {step.title}
                          </div>
                          {index < howItWorksSteps.length - 1 && (
                            <ArrowRight className='hidden h-4 w-4 text-muted-foreground md:block' />
                          )}
                        </div>
                        <p className='text-xs text-muted-foreground'>{step.description}</p>
                      </div>
                    </Card>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
