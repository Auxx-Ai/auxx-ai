// apps/homepage/src/app/_components/sections/workflow-animation/workflow-animation-section.tsx

import { WorkflowCanvas } from './workflow-canvas'

export default function WorkflowAnimationSection() {
  return (
    <section className='border-foreground/10 relative border-b'>
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3'>
        <div className='border-x'>
          <div
            aria-hidden
            className='h-3 w-full bg-[repeating-linear-gradient(-45deg,var(--color-foreground),var(--color-foreground)_1px,transparent_1px,transparent_4px)] opacity-5'
          />
          <div className='py-16 md:py-24'>
            <div className='mx-auto max-w-5xl px-6'>
              <h2 className='mx-auto max-w-2xl text-balance text-center text-3xl font-semibold lg:text-4xl'>
                Automate your Support
              </h2>
              <p className='text-muted-foreground mx-auto mt-6 max-w-xl text-pretty text-center text-lg'>
                Build intelligent workflows that classify, route, and respond to customer tickets
                automatically — powered by AI.
              </p>
              <div className='mt-12'>
                <WorkflowCanvas />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
