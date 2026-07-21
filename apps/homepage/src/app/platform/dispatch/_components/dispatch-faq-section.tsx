// apps/homepage/src/app/platform/dispatch/_components/dispatch-faq-section.tsx

import Link from 'next/link'
import { FaqJsonLd } from '../../../_components/seo/faq-json-ld'

const faqs = [
  {
    question: 'What does Auxx Dispatch include?',
    answer:
      'Service requests, quotes, a drag-to-schedule dispatch board, work orders, a worker mobile view, and invoicing with payments — all in one platform.',
  },
  {
    question: 'Do my field workers need to install an app?',
    answer:
      'No. Workers log in from a mobile browser to see their schedule, advance job status, add notes and photos, and complete checklists — no app store install required.',
  },
  {
    question: 'Can it handle recurring jobs?',
    answer:
      'Yes. Recurring visits generate automatically on a rolling window, and you can edit a single visit, all future visits, or the whole series.',
  },
  {
    question: 'Are quotes and invoices included?',
    answer:
      'Yes. Quotes support customer approval and deposits, invoices generate as PDFs, and customers can pay online.',
  },
  {
    question: 'Does it replace my helpdesk and CRM?',
    answer:
      "It doesn't replace them — it IS the same platform. Dispatch shares the same inbox, tickets, contacts, and AI as the rest of Auxx.",
  },
  {
    question: 'Does it track workers with GPS?',
    answer:
      'Live GPS tracking and a customer "on the way" link are on the roadmap. Today, the dispatch board updates live as workers advance their job status.',
  },
  {
    question: 'How is it priced?',
    answer: 'Simple plans — no per-job fees. See current pricing on the pricing page.',
  },
]

export default function DispatchFaqSection() {
  return (
    <section className='border-b'>
      <FaqJsonLd faqs={faqs} />
      <div className='mx-auto max-w-6xl px-6 py-16 md:py-24'>
        <div className='mx-auto max-w-2xl text-center'>
          <h2 className='text-balance text-4xl font-semibold md:text-5xl'>Questions, answered.</h2>
        </div>
        <dl className='mx-auto mt-12 grid max-w-4xl gap-x-10 gap-y-8 lg:grid-cols-2'>
          {faqs.map((faq) => (
            <div key={faq.question}>
              <dt className='text-foreground font-medium'>{faq.question}</dt>
              <dd className='text-muted-foreground mt-1.5 text-sm'>
                {faq.question === 'How is it priced?' ? (
                  <>
                    Simple plans — no per-job fees. See current{' '}
                    <Link href='/pricing' className='underline underline-offset-2'>
                      pricing
                    </Link>
                    .
                  </>
                ) : (
                  faq.answer
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}
