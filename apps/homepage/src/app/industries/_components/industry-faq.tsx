// apps/homepage/src/app/industries/_components/industry-faq.tsx

import { FaqJsonLd } from '../../_components/seo/faq-json-ld'

interface FaqEntry {
  question: string
  answer: string
}

export default function IndustryFaq({ faqs }: { faqs: FaqEntry[] }) {
  return (
    <section className='border-b'>
      <FaqJsonLd faqs={faqs} />
      <div className='mx-auto max-w-3xl px-6 py-16 md:py-24'>
        <div className='mx-auto max-w-2xl text-center'>
          <h2 className='text-balance text-4xl font-semibold md:text-5xl'>
            Frequently asked questions.
          </h2>
        </div>
        <dl className='mt-12 space-y-8'>
          {faqs.map((faq) => (
            <div key={faq.question}>
              <dt className='text-foreground font-medium'>{faq.question}</dt>
              <dd className='text-muted-foreground mt-2 text-sm'>{faq.answer}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}
