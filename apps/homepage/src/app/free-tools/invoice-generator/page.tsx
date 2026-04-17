// apps/homepage/src/app/free-tools/invoice-generator/page.tsx

import { getHomepageUrl } from '@auxx/config/client'
import type { Metadata } from 'next'
import Link from 'next/link'
import { LeadCaptureForm } from '../_components/lead-capture-form'
import { ToolLayout } from '../_components/tool-layout'

const TOOL_SLUG = 'invoice-generator'
const ASSET_PATH = '/free-tools/invoice-generator/auxx-invoice-template.pdf'
const CANONICAL = getHomepageUrl('/free-tools/invoice-generator')

export const metadata: Metadata = {
  title: 'Free Invoice Generator — Download a Blank Invoice Template | Auxx.ai',
  description:
    'Free blank invoice template for small businesses. Download the PDF, fill it in, and send to customers. No signup required.',
  alternates: { canonical: CANONICAL },
  openGraph: {
    title: 'Free Invoice Generator',
    description: 'Download a blank invoice template. Free PDF, no signup.',
    url: CANONICAL,
    type: 'website',
  },
}

const faqs = [
  {
    question: 'Is this invoice template really free?',
    answer:
      'Yes. Download the PDF, use it as often as you want, send it to customers. No signup, no trial, no upgrade prompts.',
  },
  {
    question: 'Can I edit the PDF?',
    answer:
      'The template has fillable fields you can type into with any modern PDF reader (Preview on Mac, Adobe Acrobat, most browsers). You can also print it and fill it in by hand.',
  },
  {
    question: 'Does this template work for freelancers, contractors, and small businesses?',
    answer:
      'It covers the fields most invoices need — sender, recipient, invoice number, dates, line items, tax, total, and payment terms. That works for freelancers, service businesses, wholesalers, and shop owners billing wholesale customers.',
  },
  {
    question: 'Do I need accounting software to use it?',
    answer:
      'No. The template is a standalone PDF. You can keep a copy per customer in a folder on your computer, or import them into accounting software later.',
  },
  {
    question: 'What payment terms should I put on an invoice?',
    answer:
      'Net 30 is the common default — the customer pays within 30 days of the invoice date. Shorter terms (Net 15, Net 7, or due on receipt) help cash flow but may push back on slow-paying customers.',
  },
  {
    question: "What's the difference between an invoice and a receipt?",
    answer:
      "An invoice is a request for payment sent before money changes hands. A receipt confirms that payment was received. You send an invoice to get paid; you send a receipt after you've been paid.",
  },
]

const howToSteps = [
  {
    name: 'Add your business name and contact details',
    text: 'Put your business name, address, phone, and email in the From block at the top of the invoice. If you have a logo, drop it in as well.',
  },
  {
    name: "Add your customer's details",
    text: 'Fill in the Bill To block with the customer name, company, and address.',
  },
  {
    name: 'Number the invoice and set dates',
    text: 'Give the invoice a unique number, set the invoice date (today) and the due date (today plus your payment terms — usually 30 days).',
  },
  {
    name: 'List what you are billing for',
    text: 'One line per item: description, quantity, unit rate, and amount. The subtotal, tax, and total should sum from the line items.',
  },
  {
    name: 'State payment terms and how to pay',
    text: 'Add a short note at the bottom: accepted payment methods (bank transfer, credit card, check), where to send payment, and any late fee policy.',
  },
]

function HowToJsonLd() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: 'How to fill out an invoice',
    step: howToSteps.map((step, idx) => ({
      '@type': 'HowToStep',
      position: idx + 1,
      name: step.name,
      text: step.text,
    })),
  }
  return (
    <script
      type='application/ld+json'
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  )
}

function Sidebar() {
  return (
    <div className='space-y-6'>
      <div className='space-y-3'>
        <h2 className='text-sm font-semibold'>Get the template</h2>
        <a
          href={ASSET_PATH}
          download
          className='inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-md hover:bg-primary/90'>
          Download the PDF
        </a>
        <p className='text-xs text-muted-foreground'>Free, no signup required.</p>
      </div>
      <div className='border-t border-border pt-5'>
        <h3 className='mb-3 text-sm font-semibold'>Or email me a copy</h3>
        <LeadCaptureForm
          toolSlug={TOOL_SLUG}
          buttonLabel='Send me the template'
          successMessage="Thanks — we'll email your copy shortly. You can also download it here."
          downloadHref={ASSET_PATH}
          downloadLabel='Download now'
          disclaimer="We'll email the PDF plus 3 tips for getting paid faster. Unsubscribe any time."
        />
      </div>
    </div>
  )
}

export default function InvoiceGeneratorPage() {
  return (
    <>
      <HowToJsonLd />
      <ToolLayout
        breadcrumb={[
          { name: 'Home', href: 'https://auxx.ai' },
          { name: 'Free Tools', href: 'https://auxx.ai/free-tools' },
          { name: 'Invoice Generator' },
        ]}
        title='Free Invoice Generator'
        subhead='Download a blank invoice template to bill customers in minutes. Free PDF. No signup required.'
        sidebar={<Sidebar />}
        faqs={faqs}
        productCta={{
          heading: 'Running out of room in spreadsheets?',
          description: 'Auxx.ai gives small businesses a CRM and customer support in one place.',
          href: '/what-is-auxx-ai',
          label: 'See how Auxx.ai works',
        }}>
        <p>
          Most small businesses do not need invoicing software. They need a clean PDF, a spot to
          type in the numbers, and a customer who actually pays. This template is that — a blank
          invoice you can fill out in any PDF reader, print, or email straight to a customer. No
          signup. No trial. No upgrade prompts after three invoices.
        </p>

        <p>Use it if you are:</p>
        <ul>
          <li>A freelancer sending your first few invoices</li>
          <li>A shop owner who needs a bill-me-later template for wholesale orders</li>
          <li>An operator who wants a consistent-looking invoice without setting up QuickBooks</li>
        </ul>

        <h2>What is in this template</h2>
        <ul>
          <li>From block: business name, address, phone, email</li>
          <li>Bill To block: customer name and address</li>
          <li>Invoice number, invoice date, due date</li>
          <li>Line items: description, quantity, rate, amount</li>
          <li>Subtotal, tax, total</li>
          <li>Notes field and payment terms</li>
        </ul>

        <h2>How to fill out an invoice</h2>
        <ol>
          {howToSteps.map((step) => (
            <li key={step.name}>
              <strong>{step.name}.</strong> {step.text}
            </li>
          ))}
        </ol>

        <h2>What to include on every invoice</h2>
        <ul>
          <li>Your legal business name and address</li>
          <li>The customer&apos;s name and address</li>
          <li>A unique invoice number (so you can reference it later)</li>
          <li>Invoice date and due date</li>
          <li>Itemized line items with quantity and rate</li>
          <li>Subtotal, tax (if applicable), and total owed</li>
          <li>Payment terms and accepted payment methods</li>
          <li>Tax ID or VAT number if your jurisdiction requires it</li>
        </ul>

        <h2>When you have outgrown a template</h2>
        <p>
          One day the template stops scaling. You are following up on unpaid invoices manually,
          digging through email threads, and losing track of who has paid and who has not. That is
          when a CRM earns its keep.
        </p>
        <p>
          Auxx.ai is an all-in-one CRM and customer support platform for small businesses. We do not
          invoice — but we do give you one place to track every customer, every conversation, and
          every follow-up. <Link href='/what-is-auxx-ai'>See how Auxx.ai works →</Link>
        </p>
      </ToolLayout>
    </>
  )
}
