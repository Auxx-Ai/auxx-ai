// apps/homepage/src/app/platform/data-model/_components/datasets-section.tsx

import { ArrowRight, FileCode, Files, FileText, FileType } from 'lucide-react'

const sources = [
  { name: 'PDF', description: 'Manuals, contracts, scanned docs.', icon: FileText },
  { name: 'DOCX', description: 'Word and Google Docs exports.', icon: Files },
  { name: 'HTML', description: 'Saved web pages and articles.', icon: FileCode },
  { name: 'Plain text', description: 'TXT, transcripts, notes.', icon: FileType },
]

const pipeline = [
  {
    step: '1',
    name: 'Extract',
    description: 'Pull clean text from each format with a dedicated extractor.',
  },
  {
    step: '2',
    name: 'Segment',
    description: 'Split into context-aware chunks that respect document structure.',
  },
  {
    step: '3',
    name: 'Embed',
    description: 'Vectorize each chunk with your selected embedding model.',
  },
  {
    step: '4',
    name: 'Search',
    description: 'Hybrid vector + keyword retrieval with org-scoped filters.',
  },
]

export default function DatasetsSection() {
  return (
    <section
      id='datasets'
      className='relative bg-muted/25 border-foreground/10 border-b scroll-mt-24'>
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3'>
        <div className='border-x'>
          <div className='py-16 md:py-24'>
            <div className='mx-auto max-w-4xl space-y-12 px-6'>
              <div className='flex items-baseline gap-3'>
                <span className='text-muted-foreground text-xs uppercase tracking-wide'>
                  Datasets
                </span>
                <span aria-hidden className='text-muted-foreground'>
                  /
                </span>
                <span className='text-muted-foreground text-xs'>Upload-driven</span>
              </div>

              <h2 className='text-foreground text-balance text-4xl font-semibold md:w-2/3'>
                Bring your own docs. We make them searchable.
              </h2>

              <p className='text-muted-foreground max-w-2xl'>
                Upload existing PDFs, manuals, exports, and pages. Auxx extracts, segments, and
                embeds them automatically — ready for Kopilot and ticket AI to cite within minutes.
              </p>

              <ul className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
                {sources.map((source) => (
                  <li
                    key={source.name}
                    className='border-foreground/5 bg-background rounded-lg border p-4'>
                    <source.icon className='text-foreground/70 size-5' />
                    <div className='mt-3 text-foreground text-sm font-medium'>{source.name}</div>
                    <p className='text-muted-foreground mt-1 text-xs'>{source.description}</p>
                  </li>
                ))}
              </ul>

              <div className='border-foreground/5 bg-background overflow-hidden rounded-xl border'>
                <div className='border-foreground/5 border-b px-4 py-2'>
                  <span className='text-muted-foreground text-xs uppercase tracking-wide'>
                    Pipeline
                  </span>
                </div>
                <ol className='grid divide-y divide-foreground/5 sm:grid-cols-4 sm:divide-y-0 sm:divide-x'>
                  {pipeline.map((stage, i) => (
                    <li key={stage.name} className='relative flex flex-col gap-2 p-5'>
                      <div className='flex items-center gap-2'>
                        <span className='text-muted-foreground text-xs font-mono'>
                          {stage.step}
                        </span>
                        <span className='text-foreground text-sm font-medium'>{stage.name}</span>
                      </div>
                      <p className='text-muted-foreground text-xs'>{stage.description}</p>
                      {i < pipeline.length - 1 && (
                        <ArrowRight
                          aria-hidden
                          className='text-foreground/20 absolute right-0 top-1/2 hidden size-4 -translate-y-1/2 translate-x-1/2 sm:block'
                        />
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
