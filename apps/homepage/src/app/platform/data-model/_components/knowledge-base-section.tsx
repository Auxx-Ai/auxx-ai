// apps/homepage/src/app/platform/data-model/_components/knowledge-base-section.tsx

import { CalendarClock, FileText, Link2, Rows3, SquareDashedKanban, Table } from 'lucide-react'
import Image from 'next/image'

const richBlocks = [
  {
    name: 'Tables',
    description: 'Structured data with sortable rows and headers.',
    icon: Table,
  },
  {
    name: 'Tabs & accordion',
    description: 'Group related content without scrolling.',
    icon: Rows3,
  },
  {
    name: 'Cards',
    description: 'Visual layouts for grouped articles or topics.',
    icon: SquareDashedKanban,
  },
  {
    name: 'Internal links',
    description: 'auxx:// references resolve to the right article.',
    icon: Link2,
  },
  {
    name: 'Version history',
    description: 'Preview any earlier draft and restore in one click.',
    icon: CalendarClock,
  },
  {
    name: 'Markdown round-trip',
    description: 'Import or export — your KB stays portable.',
    icon: FileText,
  },
]

export default function KnowledgeBaseSection() {
  return (
    <section
      id='knowledge-base'
      className='relative bg-background border-foreground/10 border-b scroll-mt-24'>
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3'>
        <div className='border-x'>
          <div className='py-16 md:py-24'>
            <div className='mx-auto max-w-4xl space-y-12 px-6'>
              <div className='flex items-baseline gap-3'>
                <span className='text-muted-foreground text-xs uppercase tracking-wide'>
                  Knowledge base
                </span>
                <span aria-hidden className='text-muted-foreground'>
                  /
                </span>
                <span className='text-muted-foreground text-xs'>Author-driven</span>
              </div>

              <h2 className='text-foreground text-balance text-4xl font-semibold md:w-2/3'>
                Write articles your way. Publish them everywhere.
              </h2>

              <div className='bg-background ring-foreground/5 overflow-hidden rounded-xl border border-transparent shadow ring-1'>
                <Image
                  src='/images/platform/knowledge-base/kb-editor.png'
                  width={3070}
                  height={1994}
                  alt='Knowledge base editor with rich block content'
                  className='h-full w-full object-cover'
                />
              </div>

              <div className='grid gap-6 md:grid-cols-2 md:gap-12'>
                <p className='text-muted-foreground'>
                  Build a fully{' '}
                  <strong className='text-foreground font-semibold'>
                    customizable self-service portal
                  </strong>{' '}
                  with your logo, colors, and domain. Articles use rich blocks, organize into
                  categories, and stay in sync across drafts and published versions.
                </p>

                <p className='text-muted-foreground'>
                  Every article doubles as{' '}
                  <strong className='text-foreground font-semibold'>AI grounding</strong>. Kopilot
                  and ticket auto-replies cite your own articles back to you with links — no
                  hallucinated answers.
                </p>
              </div>

              <ul className='grid gap-3 sm:grid-cols-2 md:grid-cols-3'>
                {richBlocks.map((block) => (
                  <li
                    key={block.name}
                    className='border-foreground/5 bg-background flex gap-3 rounded-lg border p-4'>
                    <block.icon className='text-foreground/70 mt-0.5 size-4 shrink-0' />
                    <div>
                      <div className='text-foreground text-sm font-medium'>{block.name}</div>
                      <p className='text-muted-foreground mt-0.5 text-xs'>{block.description}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
