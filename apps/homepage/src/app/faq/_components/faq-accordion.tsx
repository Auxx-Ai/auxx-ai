// apps/homepage/src/app/faq/_components/faq-accordion.tsx
'use client'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'

export interface FaqItem {
  question: string
  answer: string
}

export function FaqAccordion({ items }: { items: FaqItem[] }) {
  return (
    <Accordion type='single' collapsible className='w-full'>
      {items.map((item, index) => (
        <AccordionItem key={index} value={`item-${index}`}>
          <AccordionTrigger className='text-base font-semibold'>{item.question}</AccordionTrigger>
          <AccordionContent className='text-muted-foreground text-base leading-relaxed'>
            {item.answer}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  )
}
