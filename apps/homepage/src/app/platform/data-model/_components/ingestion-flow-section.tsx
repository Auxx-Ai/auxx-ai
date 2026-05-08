// apps/homepage/src/app/platform/data-model/_components/ingestion-flow-section.tsx
import { Database, FileSearch, Layers, Sparkles } from 'lucide-react'
import IngestionFlowIllustration from './ingestion-flow-illustration'

export default function IngestionFlowSection() {
  return (
    <section className='overflow-hidden'>
      <div className='bg-background py-24'>
        <div className='mx-auto w-full max-w-5xl px-6'>
          <div className='mx-auto max-w-3xl pb-12 text-center'>
            <h2 className='text-foreground text-balance text-4xl font-semibold'>
              From any document to instant answers
            </h2>
            <p className='text-muted-foreground my-6 text-balance text-lg'>
              Drop in PDFs, docs, and notes. We chunk them, embed them, and store them in a vector
              index so the AI can pull the exact passage that answers each customer.
            </p>
          </div>

          <div className='w-full pb-12'>
            <IngestionFlowIllustration />
          </div>

          <div className='relative grid grid-cols-2 gap-x-3 gap-y-6 border-t pt-12 sm:gap-6 lg:grid-cols-4'>
            <div className='space-y-3'>
              <div className='flex items-center gap-2'>
                <Layers className='text-foreground fill-foreground/10 size-4' />
                <h3 className='text-sm font-medium'>Smart Chunking</h3>
              </div>
              <p className='text-muted-foreground text-sm'>
                Long documents get split into semantically meaningful passages, ready for retrieval.
              </p>
            </div>
            <div className='space-y-2'>
              <div className='flex items-center gap-2'>
                <Database className='text-foreground fill-foreground/10 size-4' />
                <h3 className='text-sm font-medium'>Vector Storage</h3>
              </div>
              <p className='text-muted-foreground text-sm'>
                Embeddings are stored alongside your content so similar questions surface the right
                passage.
              </p>
            </div>
            <div className='space-y-2'>
              <div className='flex items-center gap-2'>
                <FileSearch className='text-foreground fill-foreground/10 size-4' />
                <h3 className='text-sm font-medium'>Snippet Retrieval</h3>
              </div>
              <p className='text-muted-foreground text-sm'>
                The AI fetches the top-matching snippets at answer-time and cites them inside the
                reply.
              </p>
            </div>
            <div className='space-y-2'>
              <div className='flex items-center gap-2'>
                <Sparkles className='text-foreground fill-foreground/10 size-4' />
                <h3 className='text-sm font-medium'>Grounded Replies</h3>
              </div>
              <p className='text-muted-foreground text-sm'>
                Replies are anchored in real source content—no guessing, no drift from your actual
                policies.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
