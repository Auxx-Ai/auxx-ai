// apps/homepage/src/app/startups/_components/startups-faq.tsx

import { FaqAccordion, type FaqItem } from '../../faq/_components/faq-accordion'

const faqs: FaqItem[] = [
  {
    question: 'Who is the Startup Program for?',
    answer:
      "It's built for early-stage teams: companies that have raised up to $10M in funding, have fewer than 15 employees, and are new to Auxx.",
  },
  {
    question: 'Is the eligibility enforced?',
    answer:
      "No. The criteria are self-attested guidance, not automated gates. Anyone can apply, and there's no funding, headcount, or customer-status check in the signup. We simply ask you to be honest about where your company is at.",
  },
  {
    question: 'What happens in year 2 and year 3?',
    answer:
      'The discount steps down over time: 90% off the platform fee in year one, 50% off in year two, and 25% off in year three, before moving to standard pricing. It grows with you, so you land cheap and scale into full pricing as your team takes off.',
  },
  {
    question: 'Can existing customers apply?',
    answer:
      "The program is designed for teams that are new to Auxx. If you're already an existing customer and think you'd be a fit, reach out to our team and we'll take a look.",
  },
]

// StartupsFaq renders the startup-specific FAQ accordion inside a titled section.
export default function StartupsFaq() {
  return (
    <section className='border-b'>
      <div className='mx-auto max-w-3xl px-6 py-24'>
        <div className='text-center'>
          <h2 className='text-balance text-3xl font-semibold md:text-4xl'>Startup Program FAQ</h2>
          <p className='text-muted-foreground mx-auto mt-4 max-w-xl text-balance text-lg'>
            Everything you need to know about the offer and how it works.
          </p>
        </div>
        <div className='mt-10'>
          <FaqAccordion items={faqs} />
        </div>
      </div>
    </section>
  )
}
