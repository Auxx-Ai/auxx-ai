// apps/homepage/src/app/free-tools/mesh-gradient-generator/page.tsx

import { getHomepageUrl } from '@auxx/config/client'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { ToolLayout } from '../_components/tool-layout'
import { GithubStarButton } from './_components/github-star-button'
import { GradientStudio } from './_components/gradient-studio'

const CANONICAL = getHomepageUrl('/free-tools/mesh-gradient-generator')

export const metadata: Metadata = {
  title: 'Free Mesh Gradient Generator — OpenAI Style, CSS / SVG / PNG Export | Auxx.ai',
  description:
    'Free mesh gradient generator with real-time preview. Pick colors, tweak animation and blur, export to CSS, SVG, or PNG. Includes the OpenAI 2020 gradient style. No signup.',
  alternates: { canonical: CANONICAL },
  openGraph: {
    title: 'Free Mesh Gradient Generator',
    description: 'OpenAI-style mesh gradients. Tweak in real time. Export to CSS, SVG, or PNG.',
    url: CANONICAL,
    type: 'website',
  },
}

const faqs = [
  {
    question: 'What is a mesh gradient?',
    answer:
      'A mesh gradient is a background made from overlapping soft radial color patches rather than a single linear or radial sweep. The name comes from Adobe Illustrator, but the web version is simpler: stack a handful of blurry radial-gradient layers with different colors and positions, and you get the smooth, painterly background you see on OpenAI, Linear, Stripe, and most AI-company landing pages.',
  },
  {
    question: 'Is this gradient generator actually free?',
    answer:
      'Yes. Build as many gradients as you want, export as CSS, SVG, or PNG, no account needed. Your config lives in the URL — share a gradient by sharing its link.',
  },
  {
    question: 'Can I use these gradients commercially?',
    answer:
      'Yes. The output has no license on it. Use it in a client site, a product launch, a landing page, whatever you want. The preset color palettes are just hex codes — not trademarks.',
  },
  {
    question: 'Why does OpenAI mode not export to CSS?',
    answer:
      'The OpenAI look requires a skewX transform on each radial-gradient focal point — and skew on a radial-gradient focal point is not expressible in CSS. SVG and PNG both support it. If you want a CSS-exportable result, switch to Hero, Ambient, or Mesh mode.',
  },
  {
    question: 'Can I animate the gradient on my site?',
    answer:
      'Yes. The CSS export includes a @keyframes block for the drift animation. The SVG export uses animateTransform (SMIL) for the same effect. PNG is a single frame — if you want motion, use SVG.',
  },
  {
    question: 'How is this different from other mesh gradient generators?',
    answer:
      'Three things: the OpenAI-style mode with full skewX support (most generators do not do this faithfully), real-time controls for animation and drift, and exports that work for both static and animated use cases. Your config is also encoded in the URL so you can bookmark or share a specific gradient.',
  },
]

function SoftwareAppJsonLd() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Mesh Gradient Generator',
    applicationCategory: 'DesignApplication',
    operatingSystem: 'Web',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    url: CANONICAL,
  }
  return (
    <script
      type='application/ld+json'
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  )
}

export default function MeshGradientGeneratorPage() {
  return (
    <>
      <SoftwareAppJsonLd />
      <ToolLayout
        variant='fullbleed'
        breadcrumb={[
          { name: 'Home', href: 'https://auxx.ai' },
          { name: 'Free Tools', href: 'https://auxx.ai/free-tools' },
          { name: 'Mesh Gradient Generator' },
        ]}
        title='Free Mesh Gradient Generator'
        subhead='Generate mesh gradients in the OpenAI style. Tweak colors, animation, and blur in real time. Export as CSS, SVG, or PNG. Free, no signup.'
        faqs={faqs}
        relatedTools={[
          {
            title: 'Email Signature Generator',
            href: '/free-tools/email-signature-generator',
            description: 'Build a clean HTML signature for Gmail, Outlook, or Apple Mail.',
          },
          {
            title: 'Invoice Generator',
            href: '/free-tools/invoice-generator',
            description: 'Download a blank invoice template — PDF, no signup.',
          },
          {
            title: 'Customer Support KPIs',
            href: '/free-tools/customer-support-kpis',
            description: 'Reference for the metrics that matter — CSAT, FRT, NPS, resolution time.',
          },
        ]}
        productCta={{
          heading: 'Like craft? So do we.',
          description:
            'Auxx.ai is a customer-support platform built by a team that cares about interface craft. If that sounds like your kind of tool, take a look.',
          href: '/what-is-auxx-ai',
          label: 'See what Auxx.ai is',
        }}>
        <div className='space-y-16'>
          <div className='flex justify-end'>
            <GithubStarButton />
          </div>
          <Suspense
            fallback={
              <div className='grid gap-6 lg:grid-cols-[380px_1fr]'>
                <div className='h-[600px] rounded-xl border border-border bg-card shadow-sm' />
                <div className='aspect-video rounded-xl border border-border bg-muted' />
              </div>
            }>
            <GradientStudio />
          </Suspense>

          <div className='tool-prose mx-auto max-w-3xl'>
            <h2>What is a mesh gradient?</h2>
            <p>
              A mesh gradient is a background made from overlapping soft radial color patches rather
              than a single linear or radial sweep. The name comes from Adobe Illustrator&apos;s
              &quot;gradient mesh&quot; tool, but the web version is simpler: stack a handful of
              blurry radial-gradient layers with different colors and positions, and you get the
              smooth, painterly background you see on OpenAI, Linear, Stripe, and most AI-company
              landing pages built between 2021 and 2024.
            </p>
            <p>
              The generator above has four modes. <strong>Hero</strong> places a small number of
              bold peaks via Perlin-noise heightmap — good for landing-page heroes.{' '}
              <strong>Ambient</strong> spreads five soft washes wider and faster — good for
              dashboard empty states. <strong>Mesh</strong> drops 22 small peaks for a painterly,
              multi-color look. And <strong>OpenAI</strong> scatters 12 skewed radial gradients with
              asymmetric focal points, the exact technique behind the 2020 OpenAI brand refresh.
            </p>

            <h2>How to use the output</h2>
            <p>
              Pick a mode, drop in some colors, tweak the sliders until it looks right, then copy or
              download the export format you need.
            </p>
            <ul>
              <li>
                <strong>CSS.</strong> One block with a stacked <code>radial-gradient()</code>{' '}
                background and a <code>@keyframes</code> animation if you enabled it. Paste into any
                stylesheet. Set the parent to <code>position: relative; overflow: hidden</code> if
                you are using it as a backdrop.
              </li>
              <li>
                <strong>SVG.</strong> A single self-contained SVG file. Works for every mode
                including OpenAI, and the animated version uses inline <code>animateTransform</code>{' '}
                — no JavaScript required.
              </li>
              <li>
                <strong>PNG.</strong> Rendered to a canvas in your browser at the size you choose,
                then downloaded. No upload, no server — the image never leaves your machine. PNG
                exports capture a single frame; use SVG if you want motion.
              </li>
              <li>
                <strong>React / Next.js.</strong> If you are building with our UI package, the
                component is already exported as{' '}
                <code>{`<RandomGradient colors={[...]} mode="openai" />`}</code> from{' '}
                <code>@auxx/ui</code>. Works in App Router server components out of the box.
              </li>
            </ul>

            <h2>About the OpenAI gradient</h2>
            <p>
              When OpenAI refreshed their brand in 2020, the hero backdrop was a very specific look:
              several soft radial gradients, each stretched into a skewed ellipse, scattered across
              the frame with asymmetric focal points and a slight drift animation. That combination
              — skew, asymmetric focal point, and color stops at very specific opacity curves —
              became shorthand for &quot;AI company&quot; for the next several years, and shows up
              in dozens of AI product sites today.
            </p>
            <p>
              The reason most mesh-gradient generators on the web do not reproduce this look
              faithfully: CSS cannot express skewX on a radial-gradient focal point. Our OpenAI mode
              uses SVG with a full scale/skewX/rotate/translate chain on each layer, plus SMIL{' '}
              <code>animateTransform</code> for the drift. It is more markup than a CSS gradient,
              but it is the only way to get the authentic look.
            </p>

            <h2>CSS vs SVG mesh gradients</h2>
            <p>
              CSS is simpler, animates with a single <code>@keyframes</code> rule, and works
              anywhere. But it cannot do skew on radial focal points, so you are limited to
              elliptical and elongated gradients without the asymmetric OpenAI look. SVG can do
              everything — skew, asymmetric focal points, inline animation, precise blend modes — at
              the cost of slightly more markup.
            </p>
            <p>
              Rule of thumb: if your gradient works in Hero, Ambient, or Mesh mode, CSS is fine. If
              you specifically want the OpenAI look, go SVG. PNG is there for Figma imports, email
              headers, and wallpapers — anywhere you need a raster.
            </p>

            <h2>When to use a mesh gradient on your site</h2>
            <p>
              Mesh gradients are best used as hero backdrops, dashboard empty states, email template
              headers, and feature-card backgrounds. They should <em>not</em> sit behind body text —
              the varying brightness of the peaks makes reading difficult, and the slow drift
              animation (if enabled) pulls the eye off the content. Use them for space, not for
              surfaces that need to carry copy.
            </p>
            <p>
              Blur is the easiest knob to overshoot. A small amount (10–30px) softens the layer
              boundaries and hides the seams between peaks. Going too high smears the gradient into
              a single muddy color. If your mesh gradient looks washed out, cut the blur first
              before you touch the opacity curves.
            </p>

            <h2>From gradient generators to well-designed software</h2>
            <p>
              We built this tool because we care about the craft. The same team makes{' '}
              <Link href='/what-is-auxx-ai'>Auxx.ai</Link> — a customer-support platform for small
              businesses where every screen gets the same level of attention we put into this
              generator.
            </p>
          </div>
        </div>
      </ToolLayout>
    </>
  )
}
