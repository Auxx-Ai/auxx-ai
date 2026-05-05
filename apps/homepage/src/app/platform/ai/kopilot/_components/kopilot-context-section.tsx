// apps/homepage/src/app/platform/ai/kopilot/_components/kopilot-context-section.tsx

import { Globe, Layers, Plug, Search, Telescope } from 'lucide-react'

const features = [
  {
    icon: Search,
    name: 'Semantic search',
    description: 'Instant retrieval across tickets, contacts, KB, and datasets.',
  },
  {
    icon: Layers,
    name: 'Grounded in your context',
    description: 'Emails, replies, custom fields, orders, and conversation history.',
  },
  {
    icon: Telescope,
    name: 'Understand patterns',
    description: 'See repeat issues, churn risk, and trends across signals.',
  },
  {
    icon: Plug,
    name: 'Connected tools',
    description: 'Shopify, Gmail, Outlook, Slack, and your knowledge base.',
  },
  {
    icon: Globe,
    name: 'Say hello.',
    description: 'Hola. Olá. Bonjour. Hallo. Ask Kopilot in any language.',
  },
]

export default function KopilotContextSection() {
  return (
    <section
      data-theme='dark'
      className='relative overflow-hidden bg-zinc-950 text-zinc-50 border-b border-foreground/10'>
      <ArcBackground />
      <div className='relative z-10 mx-auto max-w-6xl px-6 py-24 md:py-32'>
        <div className='text-center'>
          <span className='text-zinc-400 text-sm'>Powered by</span>
          <h2 className='mt-4 text-balance text-5xl font-semibold tracking-tight md:text-7xl'>
            Auxx Kopilot
            <sup className='ml-1 text-base align-super text-zinc-400'>™</sup>
          </h2>
        </div>

        <ul className='mt-20 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-5'>
          {features.map((f) => (
            <li key={f.name} className='space-y-3'>
              <f.icon className='size-5 text-zinc-300' />
              <div className='text-zinc-50 font-medium'>{f.name}</div>
              <p className='text-zinc-400 text-sm'>{f.description}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function ArcBackground() {
  return (
    <div aria-hidden className='pointer-events-none absolute inset-0 overflow-hidden'>
      <svg
        viewBox='0 0 1200 600'
        preserveAspectRatio='xMidYMin slice'
        className='absolute inset-0 h-full w-full'>
        <defs>
          <radialGradient id='kopilot-arc-fade' cx='50%' cy='-10%' r='65%'>
            <stop offset='0%' stopColor='rgba(255,255,255,0.2)' />
            <stop offset='100%' stopColor='rgba(255,255,255,0)' />
          </radialGradient>
          <pattern
            id='kopilot-arc-lines'
            x='0'
            y='0'
            width='6'
            height='600'
            patternUnits='userSpaceOnUse'>
            <line x1='0' y1='0' x2='0' y2='600' stroke='rgba(255,255,255,0.12)' strokeWidth='1' />
          </pattern>
          <mask id='kopilot-arc-mask'>
            <ellipse cx='600' cy='1100' rx='1000' ry='850' fill='white' />
          </mask>
        </defs>
        <rect
          x='0'
          y='0'
          width='1200'
          height='600'
          fill='url(#kopilot-arc-lines)'
          mask='url(#kopilot-arc-mask)'
        />
        <rect x='0' y='0' width='1200' height='600' fill='url(#kopilot-arc-fade)' />
      </svg>
    </div>
  )
}
