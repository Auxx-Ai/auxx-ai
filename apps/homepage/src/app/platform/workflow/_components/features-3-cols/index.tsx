// apps/web/src/app/(website)/_components/features-3-cols/index.tsx

import { GRADIENT_PALETTES } from '@auxx/ui/components/gradient-palettes'
import { RandomGradient } from '@auxx/ui/components/random-gradient'
import { ActionsCard } from './actions-card'
import { HumanNodeCard } from './human-node-card'
import { TriggersCard } from './triggers-card'

// Features3Cols renders the three feature highlight cards with shared framing.
export default function Features3Cols() {
  return (
    <section id='ai-responses' className='relative border-foreground/10 border-b'>
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3'>
        <div className='border-x'>
          <div
            aria-hidden
            className='h-3 w-full bg-[repeating-linear-gradient(-45deg,var(--color-foreground),var(--color-foreground)_1px,transparent_1px,transparent_4px)] opacity-5'
          />
          <div className='bg-muted/50 @container py-24'>
            <div className='mx-auto w-full max-w-5xl px-6'>
              <div className='relative overflow-hidden rounded-2xl p-6'>
                <RandomGradient colors={[...GRADIENT_PALETTES.ocean]} mode='mesh' animated />
                <div className='@max-4xl:max-w-sm @max-4xl:mx-auto @4xl:grid-cols-3 grid gap-6 *:p-6 relative z-10'>
                  <TriggersCard />
                  <ActionsCard />
                  <HumanNodeCard />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
