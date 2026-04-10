import { cn } from '~/lib/utils'

export default function StatsSection() {
  return (
    <section className='relative border-foreground/10 border-b bg-background @container'>
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3'>
        <div className='border-x'>
          <div
            aria-hidden
            className='h-3 w-full bg-[repeating-linear-gradient(-45deg,var(--color-foreground),var(--color-foreground)_1px,transparent_1px,transparent_4px)] opacity-5'
          />
          <div className='bg-muted/50 py-16 md:py-24'>
            <div className='mx-auto max-w-5xl px-6'>
              <h2 className='mx-auto max-w-2xl text-balance text-center text-3xl font-semibold lg:text-4xl'>
                Delivering Real Results
              </h2>
              <p className='text-muted-foreground mx-auto mt-6 max-w-xl text-pretty text-center text-lg'>
                An open-source platform that{' '}
                <strong className='text-foreground font-semibold'>
                  automates repetitive support tickets
                </strong>{' '}
                so your team can focus on what matters.
              </p>

              <div className='relative mt-12'>
                <PlusDecorator className='-translate-[calc(50%-0.5px)]' />
                <PlusDecorator className='right-0 -translate-y-[calc(50%-0.5px)] translate-x-[calc(50%-0.5px)]' />
                <PlusDecorator className='bottom-0 right-0 translate-x-[calc(50%-0.5px)] translate-y-[calc(50%-0.5px)]' />
                <PlusDecorator className='bottom-0 -translate-x-[calc(50%-0.5px)] translate-y-[calc(50%-0.5px)]' />

                <div className='**:text-center bg-background *:hover:bg-muted/25 @xl:grid-cols-3 grid grid-cols-2 divide-x border *:p-8'>
                  <div className='space-y-2'>
                    <div className='bg-linear-to-t from-foreground to-foreground/75 bg-clip-text text-3xl font-medium text-transparent md:text-5xl'>
                      100%
                    </div>
                    <p className='text-muted-foreground text-sm'>Open Source</p>
                  </div>
                  <div className='@max-xl:border-0 space-y-2'>
                    <div className='bg-linear-to-t from-foreground to-foreground/75 bg-clip-text text-3xl font-medium text-transparent md:text-5xl'>
                      20+
                    </div>
                    <p className='text-muted-foreground text-sm'>Integrations</p>
                  </div>
                  <div className='@max-xl:hidden space-y-2'>
                    <div className='bg-linear-to-t from-foreground to-foreground/75 bg-clip-text text-3xl font-medium text-transparent md:text-5xl'>
                      24/7
                    </div>
                    <p className='text-muted-foreground text-sm'>Automated Support</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

const PlusDecorator = ({ className }: { className?: string }) => (
  <div
    aria-hidden
    className={cn(
      'mask-radial-from-15% before:bg-foreground/25 after:bg-foreground/25 absolute size-3 before:absolute before:inset-0 before:m-auto before:h-px after:absolute after:inset-0 after:m-auto after:w-px',
      className
    )}
  />
)
