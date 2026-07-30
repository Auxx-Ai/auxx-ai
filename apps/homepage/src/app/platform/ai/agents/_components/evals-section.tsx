// apps/homepage/src/app/platform/ai/agents/_components/evals-section.tsx

import { FlaskConical } from 'lucide-react'
import EvalLoopIllustration from './eval-loop-illustration'

/**
 * The regression-gate story. No feature columns here: `EvalDetailGrid` carries
 * them, so this section is headline plus the interactive board.
 */
export default function EvalsSection() {
  return (
    <section className='border-b bg-background'>
      <div className='mx-auto max-w-6xl px-6 py-16 md:py-24'>
        <div className='mx-auto max-w-3xl text-center'>
          <div className='mx-auto inline-flex items-center gap-2 rounded-full border border-foreground/10 bg-muted/40 px-3 py-1 text-xs'>
            <FlaskConical className='size-3.5 text-emerald-500' />
            <span className='text-muted-foreground'>Evals · Simulations</span>
          </div>
          <h2 className='mt-6 text-balance text-4xl font-semibold md:text-5xl'>
            Ship agent changes like code.
          </h2>
          <p className='mx-auto mt-4 text-balance text-lg text-muted-foreground'>
            A prompt tweak is a deploy. Run the suite, read the diff, and know exactly what you
            fixed and what you broke, before a customer finds out.
          </p>
        </div>

        <div className='mt-14'>
          <EvalLoopIllustration />
        </div>
      </div>
    </section>
  )
}
