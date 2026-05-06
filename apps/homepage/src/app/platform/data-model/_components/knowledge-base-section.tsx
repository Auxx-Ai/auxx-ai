// apps/homepage/src/app/platform/data-model/_components/knowledge-base-section.tsx

import { CalendarClock, FileText, Link2, Rows3, SquareDashedKanban, Table } from 'lucide-react'
import { KbSurfacesCarousel } from './kb-surfaces-carousel'

const editorBlocks = [
  { name: 'Tables', icon: Table },
  { name: 'Tabs & accordion', icon: Rows3 },
  { name: 'Cards', icon: SquareDashedKanban },
  { name: 'Internal links', icon: Link2 },
  { name: 'Version history', icon: CalendarClock },
  { name: 'Markdown round-trip', icon: FileText },
]

export default function KnowledgeBaseSection() {
  return (
    <section
      id='knowledge-base'
      className='relative bg-background border-foreground/10 scroll-mt-24'>
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
            </div>

            <div className='mt-12 md:mt-16'>
              <KbSurfacesCarousel />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
