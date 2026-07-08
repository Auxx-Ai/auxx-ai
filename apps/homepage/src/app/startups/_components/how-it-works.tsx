// apps/homepage/src/app/startups/_components/how-it-works.tsx

import { CheckCircle2, Rocket, Send, Settings2 } from 'lucide-react'
import { config } from '~/lib/config'

// Steps enumerates the guided path from applying to growing on the platform.
const steps = [
  {
    icon: Send,
    title: 'Apply',
    description: 'Tell us a little about your startup and start signup with the founder offer.',
  },
  {
    icon: CheckCircle2,
    title: 'Instantly approved',
    description: 'No review queue. The startup discount applies automatically to your new org.',
  },
  {
    icon: Settings2,
    title: 'Set up your workspace',
    description: 'Connect your channels, import contacts, and let AI start drafting replies.',
  },
  {
    icon: Rocket,
    title: `Grow with ${config.shortName}`,
    description:
      'Scale your CRM and helpdesk as you grow, stepping into standard pricing over time.',
  },
]

// HowItWorks renders the four-step onboarding path in the shared bordered frame.
export default function HowItWorks() {
  return (
    <section className='relative border-foreground/10 border-b'>
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3'>
        <div className='border-x'>
          <div
            aria-hidden
            className='h-3 w-full bg-[repeating-linear-gradient(-45deg,var(--color-foreground),var(--color-foreground)_1px,transparent_1px,transparent_4px)] opacity-5'
          />
          <div className='py-24'>
            <div className='mx-auto w-full max-w-5xl px-6'>
              <div className='mx-auto mb-12 max-w-2xl text-center'>
                <span className='text-primary text-sm font-medium'>How it works</span>
                <h2 className='mt-4 text-balance text-3xl font-semibold md:text-4xl'>
                  From application to launch in minutes
                </h2>
              </div>

              <div className='grid gap-8 sm:grid-cols-2 lg:grid-cols-4'>
                {steps.map((step, index) => (
                  <div key={step.title} className='relative'>
                    <div className='bg-muted text-foreground ring-foreground/5 mb-5 flex size-10 items-center justify-center rounded-xl shadow-sm ring-1'>
                      <step.icon className='size-5' />
                    </div>
                    <div className='text-muted-foreground mb-1 text-xs font-medium'>
                      Step {index + 1}
                    </div>
                    <h3 className='text-foreground text-lg font-semibold'>{step.title}</h3>
                    <p className='text-muted-foreground mt-2 text-balance text-sm'>
                      {step.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
